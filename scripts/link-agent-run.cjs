const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.resolve(root, '..', 'agent-run');
if (JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).name !== '@technomoron/agent-run') throw new Error('Expected the sibling agent-run checkout');
const destination = path.join(root, 'node_modules', '@technomoron', 'agent-run');
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
