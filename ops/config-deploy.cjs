#!/usr/bin/env node
'use strict';
const fs = require('node:fs'),
	path = require('node:path'),
	crypto = require('node:crypto'),
	{ execFileSync } = require('node:child_process');
const { manifest, readSnapshot, mergeSnapshots, fileContents } = require('./config-policy.cjs');
const { BrainStore } = require('../dist/brain/store');
const { githubReviews } = require('../dist/brain/github-reviews');
const { listTodos } = require('../dist/brain/todos');
const { getSkills } = require('../dist/brain/skills');
const { createProfileMarker } = require('@technomoron/agent-run/dist/manifest');
const config = require('../dist/brain/remote-policy').readRemoteConfig('/etc/agent-mcp/remote.jsonc');
const data = config.dataRoot,
	state = '/var/lib/agent-mcp/config-deploy',
	catalog = '/var/lib/agent-mcp/catalogs/agent-brain-config';
fs.mkdirSync(state, { recursive: true, mode: 0o700 });
// Run a Git command against the private configuration catalog.
function git(args) {
	return execFileSync('git', ['-C', catalog, ...args], {
		encoding: 'utf8',
		maxBuffer: 100 * 1024 * 1024,
		timeout: 60000
	});
}
// Hash canonical live files to detect changes during deployment.
function digest(root) {
	const hash = crypto.createHash('sha256');
	// Add canonical file paths and bytes to the deployment digest.
	function scan(directory) {
		for (const entry of fs
			.readdirSync(directory, { withFileTypes: true })
			.sort((a, b) => a.name.localeCompare(b.name))) {
			const file = path.join(directory, entry.name),
				relative = path.relative(root, file);
			if (directory === root && ['index', 'runtime', '.git'].includes(entry.name)) continue;
			if (entry.isSymbolicLink()) throw Error('Symlink in live data: ' + relative);
			if (entry.isDirectory()) scan(file);
			else if (entry.isFile()) hash.update(relative + '\0').update(fs.readFileSync(file));
			else throw Error('Unexpected live data entry');
		}
	}
	scan(root);
	return hash.digest('hex');
}
// Extract a catalog revision into a private staging directory.
function extract(revision, directory) {
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const archive = execFileSync('git', ['-C', catalog, 'archive', revision], {
		maxBuffer: 100 * 1024 * 1024,
		timeout: 60000
	});
	execFileSync('tar', ['-xf', '-', '--no-same-owner', '-C', directory], { input: archive, timeout: 60000 });
}
// Copy live canonical data while excluding runtime, index and Git state.
function copyData(destination) {
	fs.cpSync(data, destination, {
		recursive: true,
		// Exclude runtime, index and Git state from the candidate copy.
		filter: (file) => !['index', 'runtime', '.git'].includes(path.relative(data, file).split(path.sep)[0])
	});
}
// Check staged knowledge, skills, tasks and per-repository registrations.
function validate(candidate, selection) {
	for (const repo of selection.repositories) {
		const cwd = path.join('/var/lib/agent-mcp/checkouts', ...repo.id.split('/'));
		fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
		createProfileMarker(path.join(candidate, 'projects', repo.id));
		const store = new BrainStore(candidate, cwd);
		try {
			store.allKnowledge();
			if (store.knowledgeErrors.length)
				throw Error('Invalid staged knowledge: ' + JSON.stringify(store.knowledgeErrors));
			getSkills(store);
			const reviews = githubReviews(store);
			if (reviews && reviews.repository !== repo.id)
				throw Error('GitHub issue target does not match its repository');
			listTodos(store);
			if (store.todoErrors.length) throw Error('Invalid staged tasks: ' + JSON.stringify(store.todoErrors));
			if (store.profile !== 'projects/' + repo.id || store.pool !== repo.pool)
				throw Error('Staged profile mismatch');
		} finally {
			store.close();
		}
	}
}
// Reconcile Git and live data into a validated deployment candidate.
function prepare(source, label) {
	const selection = manifest(JSON.parse(fs.readFileSync(path.join(source, '.brain-deploy.json'), 'utf8')));
	const incoming = readSnapshot(source, selection);
	const before = digest(data);
	let baseline;
	const baselineFile = path.join(state, 'baseline.json');
	if (fs.existsSync(baselineFile)) baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')).files;
	else {
		const old = path.join(state, 'original-source');
		if (!fs.existsSync(old)) extract(git(['rev-parse', 'HEAD']).trim(), old);
		baseline = readSnapshot(old, selection, { required: false });
	}
	const live = readSnapshot(data, selection, { required: false }),
		plan = mergeSnapshots(baseline, live, incoming);
	if (plan.conflicts.length)
		throw Error(
			'Live Brain changes conflict with Git; reconcile before deployment: ' + plan.conflicts.join(', ')
		);
	const candidate = path.join(state, 'candidate');
	fs.rmSync(candidate, { recursive: true, force: true });
	copyData(candidate);
	for (const [name, text] of Object.entries(plan.changes)) {
		const file = path.join(candidate, ...name.split('/'));
		if (text === null) fs.rmSync(file, { force: true });
		else {
			fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
			fs.writeFileSync(file, fileContents(text), { mode: 0o600 });
		}
	}
	validate(candidate, selection);
	if (before !== digest(data)) throw Error('Live Brain changed while staging; retry deployment');
	const prepared = { label, selection, before, files: incoming, changes: Object.keys(plan.changes) };
	fs.writeFileSync(path.join(state, 'prepared.json'), JSON.stringify(prepared), { mode: 0o600 });
	console.log(JSON.stringify({ selection, changes: prepared.changes.length }));
}
// Activate staged data and its baseline while retaining rollback state.
function activate() {
	const prepared = JSON.parse(fs.readFileSync(path.join(state, 'prepared.json'), 'utf8'));
	if (digest(data) !== prepared.before) throw Error('Live Brain changed after validation; retry deployment');
	const candidate = path.join(state, 'candidate'),
		backup = path.join(state, 'backups', Date.now().toString()),
		baseline = path.join(state, 'baseline.json');
	fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
	if (fs.existsSync(path.join(data, 'runtime')))
		fs.cpSync(path.join(data, 'runtime'), path.join(candidate, 'runtime'), { recursive: true });
	const previous = fs.existsSync(baseline) ? fs.readFileSync(baseline, 'utf8') : null;
	fs.writeFileSync(
		path.join(state, 'rollback.json'),
		JSON.stringify({ backup, previous: previous ? JSON.parse(previous) : null }),
		{ mode: 0o600 }
	);
	const nextBaseline = path.join(state, 'baseline.next.json');
	fs.writeFileSync(nextBaseline, JSON.stringify({ label: prepared.label, files: prepared.files }), {
		mode: 0o600
	});
	fs.renameSync(data, path.join(backup, 'data'));
	try {
		fs.renameSync(candidate, data);
		fs.renameSync(nextBaseline, baseline);
	} catch (error) {
		if (fs.existsSync(data)) fs.renameSync(data, candidate);
		fs.renameSync(path.join(backup, 'data'), data);
		throw error;
	}
	console.log('Configuration activated; rollback retained');
}
// Restore the previous data directory and deployment baseline.
function rollback() {
	const record = JSON.parse(fs.readFileSync(path.join(state, 'rollback.json'), 'utf8'));
	if (!fs.existsSync(path.join(record.backup, 'data'))) throw Error('No rollback data');
	fs.renameSync(data, path.join(record.backup, 'failed'));
	fs.renameSync(path.join(record.backup, 'data'), data);
	if (record.previous)
		fs.writeFileSync(path.join(state, 'baseline.json'), JSON.stringify(record.previous), { mode: 0o600 });
	else fs.rmSync(path.join(state, 'baseline.json'), { force: true });
	console.log('Configuration rolled back');
}
try {
	const [action, value] = process.argv.slice(2);
	if (action === 'prepare') {
		if (!/^[0-9a-f]{40}$/.test(value ?? '')) throw Error('Invalid Git revision');
		git(['fetch', '--no-tags', 'origin', 'main']);
		if (git(['rev-parse', 'refs/remotes/origin/main']).trim() !== value)
			throw Error('Only the current main revision may deploy');
		const source = path.join(state, 'source');
		fs.rmSync(source, { recursive: true, force: true });
		extract(value, source);
		prepare(source, value);
	} else if (action === 'prepare-local') prepare(path.resolve(value), 'local-preview');
	else if (action === 'activate') activate();
	else if (action === 'rollback') rollback();
	else throw Error('Unknown deployment action');
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
