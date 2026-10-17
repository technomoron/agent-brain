const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const output = path.resolve(process.argv[2] || '/tmp/agent-mcp-deployment.tar.gz');
const root = path.resolve(__dirname, '..');
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mcp-deploy-'));
try {
 fs.mkdirSync(path.join(build, 'vendor'));
 const packages = [path.join(root, '../agent-run'), path.join(root, '../apicore/packages/server'), root];
 const dependencies = {};
 for (const directory of packages) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const packed = JSON.parse(execFileSync('/usr/local/bin/npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', path.join(build, 'vendor')], { cwd: directory, encoding: 'utf8' }));
  dependencies[manifest.name] = 'file:vendor/' + (Array.isArray(packed) ? packed[0] : packed[manifest.name]).filename;
 }
 fs.writeFileSync(path.join(build, 'package.json'), JSON.stringify({ name: 'agent-mcp-deployment', version: '1.0.0', private: true, engines: { node: '>=24' }, dependencies }, null, 2));
 execFileSync('/usr/local/bin/npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: build, stdio: 'inherit' });
 execFileSync('tar', ['-czf', output, '-C', build, 'package.json', 'package-lock.json', 'vendor']);
 process.stdout.write(output + '\n');
} finally { fs.rmSync(build, { recursive: true, force: true }); }
