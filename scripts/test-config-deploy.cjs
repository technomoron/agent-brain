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
const { exportPlan, sync: exportSync } = require('../ops/config-sync.cjs');
test('export respects scope and review permissions, preserves Git-only changes and rejects competing edits', () => {
 const a='projects/owner/repo/memory/a.md', b='projects/other/repo/memory/b.md';
 const base={[a]:'old',[b]:'old'}, live={[a]:'Brain',[b]:'private'};
 assert.deepEqual(exportPlan(base,live,{...base},['projects/owner/repo']),{changes:{[a]:'Brain'},conflicts:[]});
 assert.deepEqual(exportPlan(base,live,{...base,[a]:'Git'},['projects/owner/repo']),{changes:{},conflicts:[a]});
 assert.deepEqual(exportPlan(base,base,{...base,[a]:'Git'},['projects/owner/repo']),{changes:{},conflicts:[]});
 assert.deepEqual(exportPlan({}, {'projects/owner/repo/skills/brain-consolidate/SKILL.md':'core'}, {}, ['projects/owner/repo']).changes,{});
 const review='projects/owner/repo/reviews/a.md', config='projects/owner/repo/config.yaml';
 assert.deepEqual(exportPlan({}, {[review]:'finding',[config]:'server roots'}, {}, ['projects/owner/repo'],false).changes,{});
 assert.deepEqual(exportPlan(base,{},base,['projects/owner/repo']).changes,{[a]:null});
});
test('real Git export commits, pushes, avoids duplicate commits and retains live data on push failure', t => {
 const {execFileSync}=require('node:child_process');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'brain-export-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const remote=path.join(root,'origin.git'),catalog=path.join(root,'catalog'),dataRoot=path.join(root,'data'),state=path.join(root,'state');
 fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');fs.mkdirSync(catalog);git(catalog,'init','--initial-branch=main');
 git(catalog,'config','user.name','Test User');git(catalog,'config','user.email','test@example.invalid');git(catalog,'remote','add','origin',remote);
 const write=(base,name,text)=>{const file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
 const selection={version:1,pools:['customer'],repositories:[{id:'owner/repo',pool:'customer'}]};
 write(catalog,'.brain-deploy.json',JSON.stringify(selection));write(catalog,'projects/owner/repo/config.yaml','name: owner/repo\npool: customer\nroots: [/source]\n');
 const name='projects/owner/repo/memory/note.md';write(catalog,name,'Original');git(catalog,'add','.');git(catalog,'commit','-m','Initial');git(catalog,'push','-u','origin','main');
 fs.cpSync(catalog,dataRoot,{recursive:true,filter:p=>!p.includes(path.sep+'.git')});fs.mkdirSync(path.join(dataRoot,'runtime'));fs.mkdirSync(state);
 write(state,'baseline.json',JSON.stringify({files:readSnapshot(catalog,selection)}));write(dataRoot,name,'Brain change');
 const opts={catalog,dataRoot,state,scopes:['projects/owner/repo']};
 const first=exportSync(opts);assert.equal(first.files,1);assert(first.commit);assert.equal(git(remote,'show','main:'+name),'Brain change');
 assert.equal(exportSync(opts).files,0);
 git(catalog,'pull','--ff-only');write(state,'baseline.json',JSON.stringify({files:readSnapshot(catalog,selection)}));
 write(dataRoot,name,'Later change');write(remote,'hooks/pre-receive','#!/bin/sh\nexit 1\n');fs.chmodSync(path.join(remote,'hooks/pre-receive'),0o755);
 assert.throws(()=>exportSync(opts),/pre-receive hook declined/);assert.equal(fs.readFileSync(path.join(dataRoot,name),'utf8'),'Later change');
 assert(!fs.existsSync(path.join(state,'catalog.lock')));
 fs.unlinkSync(path.join(remote,'hooks/pre-receive'));assert.equal(exportSync(opts).files,1);assert.equal(git(remote,'show','main:'+name),'Later change');
});
