const { test } = require('node:test'),
	assert = require('node:assert/strict'),
	fs = require('node:fs'),
	path = require('node:path'),
	os = require('node:os');
const { manifest, mergeSnapshots, readSnapshot, fileContents } = require('../ops/config-policy.cjs');
test('config merge applies Git edits, preserves independent Brain writes, and rejects concurrent edits', () => {
	const base = { 'a.md': 'original', 'deleted.md': 'remove', 'local.md': 'original' },
		live = { 'a.md': 'original', 'deleted.md': 'remove', 'local.md': 'Brain change', 'new.md': 'Brain only' },
		incoming = { 'a.md': 'Git change', 'local.md': 'original' };
	assert.deepEqual(mergeSnapshots(base, live, incoming), {
		changes: { 'a.md': 'Git change', 'deleted.md': null },
		conflicts: []
	});
	assert.deepEqual(
		mergeSnapshots({ 'a.md': 'original' }, { 'a.md': 'Brain change' }, { 'a.md': 'Git change' }),
		{ changes: {}, conflicts: ['a.md'] }
	);
	assert.deepEqual(mergeSnapshots({ 'a.md': 'original' }, {}, { 'a.md': 'original' }), {
		changes: {},
		conflicts: []
	});
});
test('deployment membership is explicit and rejects path traversal or duplicate repositories', () => {
	const good = { version: 1, pools: ['customer'], repositories: [{ id: 'owner/repo', pool: 'customer' }] };
	assert.equal(manifest(good), good);
	for (const id of ['../repo', 'owner/../../repo', 'owner/repo;echo', 'Owner/repo'])
		assert.throws(() => manifest({ ...good, repositories: [{ id, pool: 'customer' }] }));
	assert.throws(() => manifest({ ...good, repositories: [good.repositories[0], good.repositories[0]] }));
});
test('configuration snapshot ignores unserved projects and MCP-owned skills and rejects symlinks and scope leaks', (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-config-policy-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const selection = {
		version: 1,
		pools: ['customer'],
		repositories: [{ id: 'owner/repo', pool: 'customer' }]
	};
	function write(name, text) {
		const file = path.join(root, name);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
	}
	write('projects/owner/repo/config.yaml', 'name: owner/repo\npool: customer\nroots: ["C:/source"]\n');
	write('projects/unserved/repo/memory/secret.md', 'Not selected');
	write('global/skills/brain-memory/SKILL.md', 'Package owns this');
	write('pools/customer/memory/common.md', '---\nscope: pool\ntype: memory\nid: shared\n---\nCommon');
	let files = readSnapshot(root, selection);
	assert.equal(Object.keys(files).length, 3);
	const binary=Buffer.from([0x89,0x50,0x4e,0x47,0,0xff]);
	write('global/skills/custom/assets/example.png',binary);
	assert.deepEqual(fileContents(readSnapshot(root,selection)['global/skills/custom/assets/example.png']),binary);

	assert(files['projects/owner/repo/config.yaml'].includes('/var/lib/agent-mcp/checkouts/owner/repo'));
	write('pools/customer/reviews/issue.md', '---\nscope: pool\ntype: review\n---\nWrong scope');
	assert.throws(() => readSnapshot(root, selection), /per repository/);
	fs.rmSync(path.join(root, 'pools/customer/reviews'), { recursive: true });
	if (process.platform !== 'win32') {
		fs.symlinkSync('/etc/passwd', path.join(root, 'pools/customer/memory/link.md'));
		assert.throws(() => readSnapshot(root, selection), /Symlink/);
	}
});
