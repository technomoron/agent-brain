'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parse, stringify } = require('yaml');
const { parse: parseJsonc } = require('jsonc-parser');
const binaryPrefix = '\0base64:';
function fileContents(value) {
	return value.startsWith(binaryPrefix)
		? Buffer.from(value.slice(binaryPrefix.length), 'base64')
		: Buffer.from(value, 'utf8');
}
const folders = new Set([
	'rules',
	'preferences',
	'conventions',
	'constraints',
	'decisions',
	'specs',
	'reviews',
	'memory',
	'observations',
	'notes',
	'skills',
	'todo',
	'templates'
]);
const coreSkills = new Set([
	'brain-memory',
	'brain-import',
	'brain-consolidate',
	'brain-review',
	'code-review-organizer',
	'review-items',
	'todo-manager'
]);
const histories = new Set(['knowledge-history.jsonl', 'review-history.jsonl', 'review-counters.json']);
const repoPattern = /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/;
const poolPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
function manifest(value) {
	if (
		!value ||
		value.version !== 1 ||
		!Array.isArray(value.pools) ||
		!Array.isArray(value.repositories) ||
		Object.keys(value).some((k) => !['version', 'pools', 'repositories'].includes(k))
	)
		throw Error('Invalid .brain-deploy.json');
	if (
		value.pools.some((p) => typeof p !== 'string' || !poolPattern.test(p)) ||
		new Set(value.pools).size !== value.pools.length
	)
		throw Error('Invalid or duplicate pools');
	const ids = new Set();
	for (const repo of value.repositories) {
		if (
			!repo ||
			!repoPattern.test(repo.id) ||
			(repo.pool !== undefined && !value.pools.includes(repo.pool)) ||
			Object.keys(repo).some((k) => !['id', 'pool'].includes(k)) ||
			ids.has(repo.id)
		)
			throw Error('Invalid or duplicate repository or unknown pool');
		ids.add(repo.id);
	}
	if (!ids.size) throw Error('At least one repository is required');
	return value;
}
function readFile(root, relative) {
	let current = root;
	for (const part of relative.split('/')) {
		current = path.join(current, part);
		if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symlink in configuration: ' + relative);
	}
	const stat = fs.statSync(current);
	if (!stat.isFile() || stat.size > 1024 * 1024)
		throw Error('Invalid or oversized configuration file: ' + relative);
	const bytes = fs.readFileSync(current);
	const text = bytes.toString('utf8');
	if (!bytes.equals(Buffer.from(text, 'utf8')) || text.includes('\0')) {
		if (/\.(?:md|yaml|jsonc?)$/.test(relative)) throw Error('Configuration text must be UTF-8: ' + relative);
		return binaryPrefix + bytes.toString('base64');
	}
	if (/-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(text))
		throw Error('Possible credential in configuration: ' + relative);
	return text;
}
function walk(root, relative, result) {
	const directory = path.join(root, relative);
	if (!fs.existsSync(directory)) return;
	if (fs.lstatSync(directory).isSymbolicLink()) throw Error('Symlink in configuration: ' + relative);
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const child = relative + '/' + entry.name;
		if (entry.isSymbolicLink()) throw Error('Symlink in configuration: ' + child);
		if (entry.isDirectory()) walk(root, child, result);
		else result[child] = readFile(root, child);
	}
}
function validateDocument(name, text) {
	const parts = name.split('/');
	const scope = parts[0] === 'global' ? 'global' : parts[0] === 'pools' ? 'pool' : 'project';
	if ((parts.includes('todo') || parts.includes('reviews')) && scope !== 'project')
		throw Error('Tasks and findings must remain per repository: ' + name);
	const normalized = text.replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---\n') || !name.endsWith('.md')) return;
	const end = normalized.indexOf('\n---', 4);
	if (end < 0) throw Error('Unterminated front matter: ' + name);
	const metadata = parse(normalized.slice(4, end));
	if (!metadata || typeof metadata !== 'object') throw Error('Invalid front matter: ' + name);
	if (parts.includes('skills')) {
		if (
			path.posix.basename(name) === 'SKILL.md' &&
			(metadata.name !== path.posix.basename(path.posix.dirname(name)) ||
				typeof metadata.description !== 'string')
		)
			throw Error('Invalid skill: ' + name);
	} else if (metadata.scope && metadata.scope !== scope)
		throw Error('Knowledge scope does not match its directory: ' + name);
	if (metadata.type === 'review' && scope !== 'project')
		throw Error('Findings must remain per repository: ' + name);
	if (parts.includes('todo') && scope !== 'project') throw Error('Tasks must remain per repository: ' + name);
}
function readSnapshot(root, selection, { required = true, checkouts = '/var/lib/agent-mcp/checkouts' } = {}) {
	const result = {};
	let defaultChecks;
	const defaultsName = 'agent-run.defaults.jsonc';
	if (fs.existsSync(path.join(root, defaultsName))) {
		const errors = [];
		const defaults = parseJsonc(readFile(root, defaultsName), errors, { allowTrailingComma: true });
		if (errors.length) throw Error('Invalid launcher defaults');
		defaultChecks = defaults?.checks;
	}
	const scopes = [
		'global',
		...selection.pools.map((p) => 'pools/' + p),
		...selection.repositories.map((r) => 'projects/' + r.id)
	];
	for (const scope of scopes) {
		for (const folder of folders) {
			if (scope === 'global' && folder === 'skills') {
				const directory = path.join(root, scope, folder);
				if (fs.existsSync(directory))
					for (const entry of fs.readdirSync(directory))
						if (!coreSkills.has(entry)) walk(root, scope + '/skills/' + entry, result);
			} else walk(root, scope + '/' + folder, result);
		}
		for (const name of histories)
			if (fs.existsSync(path.join(root, scope, name)))
				result[scope + '/' + name] = readFile(root, scope + '/' + name);
	}
	for (const repo of selection.repositories) {
		const name = 'projects/' + repo.id + '/config.yaml';
		if (!fs.existsSync(path.join(root, name))) {
			if (required) throw Error('Missing project configuration: ' + name);
			continue;
		}
		const project = parse(readFile(root, name));
		if (!project || project.name !== repo.id || project.pool !== repo.pool) {
			if (required) throw Error('Project name or pool mismatch: ' + name);
			continue;
		}
		project.roots = [path.join(checkouts, ...repo.id.split('/'))];
		result[name] = stringify(project);
		const launcherName = 'projects/' + repo.id + '/agent-run.jsonc';
		let checks = defaultChecks;
		if (fs.existsSync(path.join(root, launcherName))) {
			const errors = [];
			const launcher = parseJsonc(readFile(root, launcherName), errors, { allowTrailingComma: true });
			if (errors.length) throw Error('Invalid project launcher configuration: ' + launcherName);
			checks = launcher?.checks ?? checks;
		}
		if (checks !== undefined && (!Array.isArray(checks) || checks.some((check) => typeof check !== 'string')))
			throw Error('Invalid project checks: ' + launcherName);
		// Only render context belongs on Brain. Native client settings and credentials stay client-side.
		result[launcherName] = JSON.stringify(checks === undefined ? {} : { checks }, null, 2) + '\n';

		const reviewName = 'projects/' + repo.id + '/review.jsonc';
		if (fs.existsSync(path.join(root, reviewName))) {
			const errors = [];
			const text = readFile(root, reviewName),
				review = parseJsonc(text, errors);
			if (
				errors.length ||
				!review ||
				review.backend !== 'github' ||
				(review.repository && review.repository !== repo.id) ||
				(review.tokenEnv && !/^[A-Z_][A-Z0-9_]*$/.test(review.tokenEnv)) ||
				(review.writesEnabled !== undefined && typeof review.writesEnabled !== 'boolean') ||
				Object.keys(review).some((k) => !['backend', 'repository', 'tokenEnv', 'writesEnabled'].includes(k))
			)
				throw Error('Invalid per-repository GitHub review configuration: ' + reviewName);
			result[reviewName] = text;
		}
	}
	if (fs.existsSync(path.join(root, 'brain.jsonc'))) {
		const errors = [];
		const config = parseJsonc(readFile(root, 'brain.jsonc'), errors, { allowTrailingComma: true });
		if (errors.length || !config || typeof config !== 'object') throw Error('Invalid brain.jsonc');
		result['brain.jsonc'] = JSON.stringify(config, null, 2) + '\n';
	}
	for (const [name, text] of Object.entries(result)) validateDocument(name, text);
	return result;
}
function mergeSnapshots(base, live, incoming) {
	const changes = {},
		conflicts = [];
	for (const name of new Set([...Object.keys(base), ...Object.keys(incoming)])) {
		const before = base[name],
			current = live[name],
			next = incoming[name];
		if (name.endsWith('/config.yaml') || name.endsWith('/agent-run.jsonc')) {
			if (next !== undefined && current !== next) changes[name] = next;
			continue;
		}
		if (current === next || before === next) continue;
		if (current === before) changes[name] = next ?? null;
		else conflicts.push(name);
	}
	return { changes, conflicts };
}
module.exports = { manifest, readSnapshot, mergeSnapshots, fileContents, repoPattern, poolPattern, coreSkills };
