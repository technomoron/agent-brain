#!/usr/bin/env node
'use strict';
const fs = require('node:fs'),
	{ execFileSync } = require('node:child_process');
const { manifest } = require('./config-policy.cjs');
const worker = '/opt/agent-mcp/current/node_modules/@technomoron/agent-brain/ops/config-deploy.cjs';
const file = '/etc/agent-mcp/remote.jsonc',
	lock = '/var/lib/agent-mcp/config-deploy/catalog.lock',
	maintenance = '/run/agent-brain-config-deploy-maintenance';
let interrupted = false;
// Let deployment checkpoints detect termination requests and restore service availability.
for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT'])
	process.on(signal, () => {
		interrupted = true;
	});
// Run a configuration deployment step as the Brain service user.
function run(action, value) {
	return execFileSync(
		'/usr/sbin/runuser',
		['-u', 'agent-mcp', '--', '/usr/local/bin/node', worker, action, ...(value ? [value] : [])],
		{ encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 }
	);
}
// Control the Brain service through systemd.
function service(action) {
	execFileSync('/usr/bin/systemctl', [action, 'agent-mcp'], { timeout: 60000 });
}
// Atomically replace server configuration while preserving its group ownership.
function save(text) {
	const temporary = file + '.deploy.tmp';
	fs.writeFileSync(temporary, text, { mode: 0o640 });
	fs.chownSync(temporary, 0, fs.statSync(file).gid);
	fs.renameSync(temporary, file);
}
// Wait for OAuth discovery and unauthenticated MCP rejection after deployment.
async function healthy(config) {
	const base = 'http://127.0.0.1:' + config.listen.port;
	for (let attempt = 0; attempt < 40; attempt++) {
		if (interrupted) throw Error('Deployment interrupted');
		try {
			const metadata = await fetch(base + '/.well-known/oauth-authorization-server/oauth', {
				signal: AbortSignal.timeout(1000)
			});
			if (metadata.ok) {
				const rejected = await fetch(base + '/mcp', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
					signal: AbortSignal.timeout(1000)
				});
				if (rejected.status === 401) return;
			}
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw Error('Brain did not pass deployment health checks');
}
// Stage and activate a configuration push, restoring the previous state on failure.
(async () => {
	if (process.getuid?.() !== 0) throw Error('Deployment controller must run as root');
	const match = /^deploy ([0-9a-f]{40})$/.exec(process.argv[2] ?? '');
	if (!match) throw Error('Expected deploy followed by one full Git SHA');
	fs.mkdirSync(lock, { mode: 0o700 });
	let activated = false,
		gated = false,
		original;
	try {
		const staged = JSON.parse(run('prepare', match[1])),
			selection = manifest(staged.selection);
		original = fs.readFileSync(file, 'utf8');
		const config = require('../dist/brain/remote-policy').readRemoteConfig(file);
		if (!config.dataRoot) throw Error('Configuration deployment requires central dataRoot');
		const next = {
			...config,
			groups: selection.pools.map((id) => ({ id, configRoot: config.dataRoot })),
			repositories: selection.repositories.map((repo) => ({
				id: repo.id,
				group: repo.pool,
				configRoot: config.dataRoot,
				cwd: '/var/lib/agent-mcp/checkouts/' + repo.id
			}))
		};
		fs.copyFileSync(file, file + '.before-config-push-' + Date.now());
		if (interrupted) throw Error('Deployment interrupted');
		fs.writeFileSync(maintenance, 'Configuration deployment in progress\n', { mode: 0o644 });
		gated = true;
		service('stop');
		run('activate');
		activated = true;
		save(JSON.stringify(next, null, 2) + '\n');
		service('start');
		await healthy(next);
		console.log(
			'Deployed ' +
				match[1] +
				'; ' +
				staged.changes +
				' files changed; ' +
				selection.repositories.length +
				' repositories; Brain healthy'
		);
	} catch (error) {
		if (activated) {
			service('stop');
			run('rollback');
			save(original);
		}
		service('start');
		throw error;
	} finally {
		if (gated) fs.rmSync(maintenance, { force: true });
		fs.rmdirSync(lock);
	}
})().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
