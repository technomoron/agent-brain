const fs = require('node:fs');
const path = require('node:path');
const destination = path.resolve(__dirname, '../node_modules/@technomoron/apicore-server');
const source = path.resolve(__dirname, '../../apicore/packages/server');
if (JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).name !== '@technomoron/apicore-server') throw new Error('Expected the sibling apicore checkout');
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.symlinkSync(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
