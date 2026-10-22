const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mcp-bin-'));
try {
	for (const name of ['agent-mcp', 'agent-brain']) {
		const entry = path.join(root, 'dist', 'agent-brain.js');
		if (process.platform === 'win32') {
			fs.writeFileSync(path.join(bin, name + '.cmd'), `@"${process.execPath}" "${entry}" %*\r\n`);
		} else fs.symlinkSync(entry, path.join(bin, name));
	}
	const result = spawnSync('bash', [path.join(root, 'scripts', 'test-launcher.sh')], {
		cwd: root, stdio: 'inherit', shell: false,
		env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH }
	});
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
	if (process.exitCode === 0) {
		const remote = spawnSync(process.execPath, ['--test', path.join(root, 'scripts/test-remote.cjs'), path.join(root, 'scripts/test-config-deploy.cjs')], { cwd: root, stdio: 'inherit', shell: false });
		if (remote.error) throw remote.error;
		process.exitCode = remote.status ?? 1;
	}
} finally { fs.rmSync(bin, { recursive: true, force: true }); }
