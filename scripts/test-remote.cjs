const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createRemoteApi}=require('../dist/brain/remote-server.js');
const {allowedGrant,repositoryPermissions,toolPermission,remoteConfigSchema}=require('../dist/brain/remote-policy.js');
// Create an isolated remote server configuration.
function config(root){return {issuer:'https://mcp.example/oauth',resource:'https://mcp.example/mcp',runtime:path.join(root,'runtime'),users:[{subject:'bot',login:'bot',kind:'service'}],clients:[{id:'service',kind:'service',subject:'bot',secretEnv:'MCP_TEST_CLIENT_SECRET',repos:['technomoron/*'],permissions:['read','write','review']}],access:[{subject:'bot',repos:['technomoron/a'],permissions:['read','write']},{subject:'bot',repos:['technomoron/b'],permissions:['read']}],repositories:['a','b'].map(id=>({id:'technomoron/'+id,configRoot:path.join(root,id),cwd:path.join(root,id)}))};}
test('repository policy intersects user, client and token grants without cross-repository escalation',()=>{let c=remoteConfigSchema.parse(config('/tmp/policy'));assert(allowedGrant(c,'bot','service',['read','repo:technomoron/a']));assert(!allowedGrant(c,'bot','service',['read','write','repo:technomoron/b']));assert(!allowedGrant(c,'bot','service',['read','repo:*']));assert.deepEqual([...repositoryPermissions(c,'bot','service',['read','write','repo:technomoron/*'],'technomoron/b')],['read']);c.users[0].kind='human';assert.equal(repositoryPermissions(c,'bot','service',['read','repo:*'],'technomoron/a').size,0);assert.equal(toolPermission('future_unknown_tool'),null);assert.equal(toolPermission('brain_sync'),'write');assert.equal(toolPermission('brain_flush'),'write');});
test('remote OAuth service grants enforce current policy on every MCP request',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-remote-'));let service;try{const c=config(root);for(const r of c.repositories)fs.mkdirSync(r.configRoot);const file=path.join(root,'remote.json');fs.writeFileSync(file,JSON.stringify(c));process.env.MCP_TEST_CLIENT_SECRET='test-service-secret';process.env.MCP_OAUTH_ACCESS_SECRET='access'.repeat(8);process.env.MCP_OAUTH_REFRESH_SECRET='refresh'.repeat(8);service=await createRemoteApi(file);await service.api.fastify.ready();const app=service.api.fastify;
assert.equal((await app.inject({method:'POST',url:'/mcp',payload:{}})).statusCode,401);
const grant=await app.inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams({grant_type:'client_credentials',client_id:'service',client_secret:process.env.MCP_TEST_CLIENT_SECRET,scope:'read repo:technomoron/a',resource:c.resource}).toString()});assert.equal(grant.statusCode,200,grant.body);const token=grant.json().access_token;assert.equal(grant.json().refresh_token,undefined);
// Send a request to the test API.
const request=(repository,method,params={})=>app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+token,'x-agent-repository':repository,accept:'application/json, text/event-stream'},payload:{jsonrpc:'2.0',id:1,method,params}});
assert.equal((await request('technomoron/b','tools/list')).statusCode,403);const list=await request('technomoron/a','tools/list');assert.equal(list.statusCode,200,list.body);const names=list.json().result.tools.map(x=>x.name);assert(names.includes('get_knowledge'));assert(!names.includes('remember'));assert(!names.includes('sync'));assert(!names.includes('brain_sync'));assert(!names.includes('brain_flush'));const denied=await request('technomoron/a','tools/call',{name:'remember',arguments:{}});assert(denied.json().error || denied.json().result?.isError);
c.users[0].disabled=true;fs.writeFileSync(file,JSON.stringify(c));assert.equal((await request('technomoron/a','tools/list')).statusCode,403);
}finally{await service?.close();fs.rmSync(root,{recursive:true,force:true});delete process.env.MCP_TEST_CLIENT_SECRET;delete process.env.MCP_OAUTH_ACCESS_SECRET;delete process.env.MCP_OAUTH_REFRESH_SECRET;}});
test('GitHub retries survive delayed issue lists; updates preserve discussion and reject stale revisions',async()=>{const {GithubReviews}=require('../dist/brain/github-reviews.js');const root=fs.mkdtempSync(path.join(os.tmpdir(),'github-review-'));fs.mkdirSync(path.join(root,'runtime'));const original=global.fetch;let posts=0;let issue;global.fetch=async(url,options)=>{if(options.method==='POST'){posts++;issue={number:1,title:JSON.parse(options.body).title,body:JSON.parse(options.body).body,state:'open',html_url:'https://github.com/owner/repo/issues/1',updated_at:'2026-10-16T12:00:00Z'};}else if(options.method==='PATCH'){issue={...issue,...JSON.parse(options.body),updated_at:'2026-10-16T12:01:00Z'};}else if(url.includes('?'))return new Response('[]');return Response.json(issue);};process.env.MCP_TEST_GITHUB_TOKEN='fake';try{
// Create a GitHub review backend with isolated retry storage.
const make=()=>new GithubReviews({
// Resolve a path beneath the temporary test root.
safePath:(...p)=>path.join(root,...p)},{backend:'github',writesEnabled:true,tokenEnv:'MCP_TEST_GITHUB_TOKEN'},'owner/repo');const input={key:'retry-key',title:'Finding',content:'Original finding',severity:'low',applies_to:[],confirmed:true};let a=await make().create(input);let retry=await make().create(input);assert.equal(retry.created,false);assert.equal(posts,1);issue.body='User introduction\n\n'+issue.body+'\nUser discussion';a=await make().get(a.id);let b=await make().update(a.id,a.revision,{severity:'high'});assert(b.content.startsWith('User introduction'));assert(b.content.includes('Original finding'));assert(b.content.endsWith('User discussion'));await assert.rejects(make().update(a.id,a.revision,{title:'Stale'}),/changed/);await assert.rejects(make().get('github:other/repo#1'),/configured repository/);let closed=await make().resolve(b.id,b.revision,'fixed','Verified');assert.equal(closed.state,'fixed');await assert.rejects(make().create({...input,key:'reserved',content:'<!-- agent-mcp-review:end -->'}),/reserved/);}finally{global.fetch=original;delete process.env.MCP_TEST_GITHUB_TOKEN;fs.rmSync(root,{recursive:true,force:true});}});
test('an unconfigured deployment publishes discovery and denies MCP access',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-closed-'));let service;try{const c=config(root);c.users=[];c.clients=[];c.access=[];c.repositories=[];fs.writeFileSync(path.join(root,'remote.json'),JSON.stringify(c));process.env.MCP_OAUTH_ACCESS_SECRET='access'.repeat(8);process.env.MCP_OAUTH_REFRESH_SECRET='refresh'.repeat(8);service=await createRemoteApi(path.join(root,'remote.json'));assert.equal((await service.api.fastify.inject({url:'/.well-known/oauth-authorization-server/oauth'})).statusCode,200);assert.equal((await service.api.fastify.inject({method:'POST',url:'/mcp',payload:{}})).statusCode,401);}finally{await service?.close();fs.rmSync(root,{recursive:true,force:true});delete process.env.MCP_OAUTH_ACCESS_SECRET;delete process.env.MCP_OAUTH_REFRESH_SECRET;}});
test('declared groups share common knowledge while project knowledge and token access stay isolated',async()=>{
 const {BrainStore}=require('../dist/brain/store.js');const {readRemoteConfig,validateRepositoryRoots}=require('../dist/brain/remote-policy.js');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-group-'));let service;
 try {
  const c=config(root);const shared=path.join(root,'shared');fs.mkdirSync(shared);c.groups=[{id:'agent-tools',configRoot:shared}];
  for(const r of c.repositories){fs.mkdirSync(r.cwd);r.configRoot=shared;r.group='agent-tools';const p=path.join(shared,'projects',r.id);fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'config.yaml'),JSON.stringify({name:r.id,roots:[r.cwd]}));fs.writeFileSync(path.join(p,'agent-run.jsonc'),'{}');}
  const file=path.join(root,'remote.json');fs.writeFileSync(file,JSON.stringify(c));const parsed=readRemoteConfig(file);validateRepositoryRoots(parsed,true);
  const a=new BrainStore(shared,c.repositories[0].cwd),b=new BrainStore(shared,c.repositories[1].cwd);
  try{assert.equal(a.profile,'projects/technomoron/a');assert.equal(b.profile,'projects/technomoron/b');const common=a.remember({scope:'global',type:'memory',authority:'user',title:'Shared group knowledge',content:'Common architecture'});const own=a.remember({scope:'project',type:'memory',authority:'inferred',title:'Private repo note',content:'Only repository A'});assert.equal(b.get(common.id).id,common.id);assert(!b.allKnowledge().some(x=>x.id===own.id));assert.throws(()=>b.get(own.id));assert.equal(b.search('Only repository A').some(x=>x.id===own.id),false);}finally{a.close();b.close();}
  const bad=structuredClone(parsed);delete bad.repositories[1].group;assert.throws(()=>validateRepositoryRoots(bad),/non-overlapping/);bad.repositories[1].group='unknown';assert.throws(()=>validateRepositoryRoots(bad),/declared group/);
  process.env.MCP_TEST_CLIENT_SECRET='test-service-secret';process.env.MCP_OAUTH_ACCESS_SECRET='access'.repeat(8);process.env.MCP_OAUTH_REFRESH_SECRET='refresh'.repeat(8);service=await createRemoteApi(file);
  const app=service.api.fastify;const grant=await app.inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams({grant_type:'client_credentials',client_id:'service',client_secret:process.env.MCP_TEST_CLIENT_SECRET,scope:'read repo:technomoron/a',resource:c.resource}).toString()});assert.equal(grant.statusCode,200,grant.body);
  // Send a test MCP tool request.
  const call=repo=>app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+grant.json().access_token,'x-agent-repository':repo,accept:'application/json, text/event-stream'},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'brain_status',arguments:{}}}});
  const status=await call('technomoron/a');assert.equal(status.statusCode,200);assert.equal(JSON.parse(status.json().result.content[0].text).group,'agent-tools');assert.equal((await call('technomoron/b')).statusCode,403);
  // Issue an OAuth token with the requested test scopes.
  async function token(scope){const r=await app.inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams({grant_type:'client_credentials',client_id:'service',client_secret:process.env.MCP_TEST_CLIENT_SECRET,scope,resource:c.resource}).toString()});assert.equal(r.statusCode,200,r.body);return r.json().access_token;}
  // Invoke the selected write tool with a scoped test token.
  async function write(token,name,args){const r=await app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+token,'x-agent-repository':'technomoron/a',accept:'application/json, text/event-stream'},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});assert.equal(r.statusCode,200,r.body);return r.json().result;}
  const narrow=await token('read write repo:technomoron/a');
  const input={scope:'global',type:'memory',authority:'user',title:'Shared scope test',content:'Must require all members'};
  assert.equal((await write(narrow,'remember',input)).isError,true);
  assert.equal((await write(narrow,'remember',{...input,scope:'project'})).isError,undefined);
  c.access=[{subject:'bot',repos:['technomoron/*'],permissions:['read','write']}];fs.writeFileSync(file,JSON.stringify(c));
  const full=await token('read write repo:technomoron/*');
  const created=await write(full,'remember',input);assert.equal(created.isError,undefined);
  const item=JSON.parse(created.content[0].text);
  for(const [name,args] of [['amend_knowledge',{id:item.id,revision:item.revision,changes:{title:'Denied'}}],['deprecate_knowledge',{id:item.id,revision:item.revision}],['promote',{id:item.id,revision:item.revision,scope:'project',confirmed:true}]])assert.equal((await write(narrow,name,args)).isError,true);
 }finally{await service?.close();fs.rmSync(root,{recursive:true,force:true});for(const name of ['MCP_TEST_CLIENT_SECRET','MCP_OAUTH_ACCESS_SECRET','MCP_OAUTH_REFRESH_SECRET'])delete process.env[name];}
});
test('discovery before repository selection lists only projects allowed by user, client and token',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-discovery-'));let service;
 try {
  const c=config(root);c.clients[0].repos=['*'];c.access=[{subject:'bot',repos:['*'],permissions:['read','write','review']}];
  const shared=path.join(root,'shared');fs.mkdirSync(shared);c.groups=[{id:'visible-group',configRoot:shared}];
  for(const r of c.repositories){fs.mkdirSync(r.cwd);r.configRoot=shared;r.group='visible-group';const p=path.join(shared,'projects',r.id);fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'config.yaml'),JSON.stringify({name:r.id,display_name:'Project '+r.id.split('/')[1],roots:[r.cwd]}));fs.writeFileSync(path.join(p,'agent-run.jsonc'),'{}');}
  // A project on disk does not become a remotely served repository by itself.
  const extra=path.join(shared,'projects','private','unregistered');fs.mkdirSync(extra,{recursive:true});fs.writeFileSync(path.join(extra,'config.yaml'),JSON.stringify({name:'private/unregistered',roots:[path.join(root,'unregistered')]}));
  const file=path.join(root,'remote.json');fs.writeFileSync(file,JSON.stringify(c));process.env.MCP_TEST_CLIENT_SECRET='test-service-secret';process.env.MCP_OAUTH_ACCESS_SECRET='access'.repeat(8);process.env.MCP_OAUTH_REFRESH_SECRET='refresh'.repeat(8);service=await createRemoteApi(file);const app=service.api.fastify;
  // Issue an OAuth grant for the test identity.
  async function grant(scope){const r=await app.inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams({grant_type:'client_credentials',client_id:'service',client_secret:process.env.MCP_TEST_CLIENT_SECRET,scope,resource:c.resource}).toString()});assert.equal(r.statusCode,200,r.body);return r.json().access_token;}
  const all=await grant('read write repo:*'),narrow=await grant('read repo:technomoron/a');
  // Send a JSON-RPC request with the test token.
  const rpc=(token,method,params,repository)=>app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+token,accept:'application/json, text/event-stream',...(repository?{'x-agent-repository':repository}:{})},payload:{jsonrpc:'2.0',id:1,method,params}});
  // Invoke a scoped tool on the test server.
  const invoke=async(token,name,repository)=>{const r=await rpc(token,'tools/call',{name,arguments:{}},repository);assert.equal(r.statusCode,200,r.body);return JSON.parse(r.json().result.content[0].text);};
  const tools=await rpc(all,'tools/list',{});assert.deepEqual(tools.json().result.tools.map(t=>t.name).sort(),['list_repositories','list_repository_groups']);
  const forbidden=await rpc(all,'tools/call',{name:'get_knowledge',arguments:{id:'x'}});assert(forbidden.json().error || forbidden.json().result?.isError);
  let result=await invoke(all,'list_repositories');assert.deepEqual(result.repositories.map(r=>r.id),['technomoron/a','technomoron/b']);assert.equal(result.repositories[0].name,'Project a');assert(!JSON.stringify(result).includes(root));assert.deepEqual(result.repositories[0].permissions,['read','write']);
  assert.deepEqual((await invoke(narrow,'list_repositories')).repositories.map(r=>r.id),['technomoron/a']);let groups=(await invoke(narrow,'list_repository_groups')).groups;assert.equal(groups[0].id,'visible-group');assert.equal(groups[0].repositories.length,1);
  assert.equal((await invoke(all,'list_repositories','technomoron/a')).repositories.length,2);
  c.access=[{subject:'bot',repos:['technomoron/b'],permissions:['read']}];fs.writeFileSync(file,JSON.stringify(c));result=await invoke(all,'list_repositories');assert.deepEqual(result.repositories.map(r=>r.id),['technomoron/b']);assert.deepEqual(result.repositories[0].permissions,['read']);assert.deepEqual((await invoke(narrow,'list_repository_groups')).groups,[]);
  c.access=[{subject:'bot',repos:['*'],permissions:['read','write']}];c.clients[0].repos=['technomoron/a'];fs.writeFileSync(file,JSON.stringify(c));assert.deepEqual((await invoke(all,'list_repositories')).repositories.map(r=>r.id),['technomoron/a']);
  c.users[0].disabled=true;fs.writeFileSync(file,JSON.stringify(c));assert.equal((await rpc(all,'tools/list',{})).statusCode,403);
 }finally{await service?.close();fs.rmSync(root,{recursive:true,force:true});for(const name of ['MCP_TEST_CLIENT_SECRET','MCP_OAUTH_ACCESS_SECRET','MCP_OAUTH_REFRESH_SECRET'])delete process.env[name];}
});

test('central pools prevent narrow tokens modifying shared scopes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-pools-'));let service;
 try{
 const c=config(root);c.dataRoot=path.join(root,'data');fs.mkdirSync(c.dataRoot);
 c.groups=[{id:'customer',configRoot:c.dataRoot}];c.access=[{subject:'bot',repos:['*'],permissions:['read','write','review']}];c.clients[0].repos=['*'];
 for(const r of c.repositories){fs.mkdirSync(r.cwd);r.configRoot=c.dataRoot;r.group='customer';const dir=path.join(c.dataRoot,'projects',r.id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'config.yaml'),require('yaml').stringify({name:r.id,roots:[r.cwd],pool:'customer'}));fs.writeFileSync(path.join(dir,'agent-run.jsonc'),'{}');}
 const file=path.join(root,'remote.json');fs.writeFileSync(file,JSON.stringify(c));process.env.MCP_TEST_CLIENT_SECRET='test-secret'.repeat(4);process.env.MCP_OAUTH_ACCESS_SECRET='access'.repeat(8);process.env.MCP_OAUTH_REFRESH_SECRET='refresh'.repeat(8);
 service=await createRemoteApi(file);const app=service.api.fastify;
 // Issue an OAuth grant for the test identity.
 async function grant(scope){const r=await app.inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams({grant_type:'client_credentials',client_id:'service',client_secret:process.env.MCP_TEST_CLIENT_SECRET,scope,resource:c.resource}).toString()});assert.equal(r.statusCode,200,r.body);return r.json().access_token;}
 // Save a test record through the remote API.
 async function remember(token,scope){const r=await app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+token,accept:'application/json, text/event-stream','x-agent-repository':'technomoron/a'},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'remember',arguments:{scope,type:'memory',authority:'user',title:'Scope test',content:'Shared scope write'}}}});assert.equal(r.statusCode,200,r.body);return r.json().result;}
 const narrow=await grant('read write repo:technomoron/a'),all=await grant('read write repo:*');
 assert.equal((await remember(narrow,'global')).isError,true);assert.equal((await remember(narrow,'pool')).isError,true);assert.equal((await remember(narrow,'project')).isError,undefined);assert.equal((await remember(all,'global')).isError,undefined);assert.equal((await remember(all,'pool')).isError,undefined);
 const cp=require('node:child_process'), originalExec=cp.execFile;let exported;
 c.gitSync={catalog:path.join(root,'catalog'),state:path.join(root,'state')};
 // Recreate the service so the new immutable administrator setting is loaded.
 await service.close();fs.writeFileSync(file,JSON.stringify(c));service=await createRemoteApi(file);
 // Existing app/provider is closed, so use fresh tokens and the new app for these calls.
 const syncApp=service.api.fastify;
 // Issue a token with the requested synchronization scopes.
 async function syncGrant(scope){const r=await syncApp.inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams({grant_type:'client_credentials',client_id:'service',client_secret:process.env.MCP_TEST_CLIENT_SECRET,scope,resource:c.resource}).toString()});return r.json().access_token;}
 // Request a remote Brain synchronization.
 async function flush(token){return syncApp.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+token,accept:'application/json, text/event-stream','x-agent-repository':'technomoron/a'},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'brain_flush',arguments:{}}}});}
 cp.execFile=(executable,args,options,callback)=>({stdin:{
 // Capture export input and return a successful worker response.
 end(input){exported=JSON.parse(input);callback(null,JSON.stringify({state:'synced',files:0}),'');}}});
 try{
 const narrowSync=await syncGrant('read write repo:technomoron/a');assert.equal((await flush(narrowSync)).json().result.isError,undefined);assert.deepEqual(exported.scopes,['projects/technomoron/a']);assert.equal(exported.reviews,false);
 const allSync=await syncGrant('read write review repo:*');await flush(allSync);assert.deepEqual(exported.scopes,['projects/technomoron/a','pools/customer','global']);assert.equal(exported.reviews,true);
 }finally{cp.execFile=originalExec;}

 }finally{await service?.close();fs.rmSync(root,{recursive:true,force:true});for(const name of ['MCP_TEST_CLIENT_SECRET','MCP_OAUTH_ACCESS_SECRET','MCP_OAUTH_REFRESH_SECRET'])delete process.env[name];}
});

test('human OAuth login accepts plaintext environment passwords and existing bcrypt hashes', async () => {
 const {createHash}=require('node:crypto');
 const {MemAuthStore}=require('@technomoron/apicore-server');
 const {readRemoteConfig}=require('../dist/brain/remote-policy');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'brain-password-'));
 const names=['MCP_TEST_PASSWORD','MCP_TEST_PASSWORD_HASH','MCP_OAUTH_ACCESS_SECRET','MCP_OAUTH_REFRESH_SECRET'];
 const previous=names.map(name=>process.env[name]);
 let service;
 try {
  process.env.MCP_TEST_PASSWORD='test password with spaces';
  process.env.MCP_OAUTH_ACCESS_SECRET='access'.repeat(8);
  process.env.MCP_OAUTH_REFRESH_SECRET='refresh'.repeat(8);
  const authStore=new MemAuthStore({passkeys:false});
  const stored=await authStore.userStore.createUser({login:'human',email:'human@example.com',password:process.env.MCP_TEST_PASSWORD});
  process.env.MCP_TEST_PASSWORD_HASH=authStore.getUserPasswordHash(stored);
  const c=config(root);c.repositories=[];c.users=[{subject:'human',login:'human@example.com',passwordEnv:'MCP_TEST_PASSWORD'}];
  c.clients=[{id:'desktop',kind:'public',redirectUris:['http://127.0.0.1:8123/callback'],repos:['technomoron/*'],permissions:['read']}];
  c.access=[{subject:'human',repos:['technomoron/*'],permissions:['read']}];
  const file=path.join(root,'remote.json');
  for(const mode of ['plaintext','hash']) {
   if(mode==='hash'){delete c.users[0].passwordEnv;c.users[0].passwordHashEnv='MCP_TEST_PASSWORD_HASH';}
   fs.writeFileSync(file,JSON.stringify(c));
   service=await createRemoteApi(file);const app=service.api.fastify;
   for(const password of ['wrong password',process.env.MCP_TEST_PASSWORD]) {
    const params=new URLSearchParams({response_type:'code',client_id:'desktop',redirect_uri:c.clients[0].redirectUris[0],scope:'read repo:technomoron/*',resource:c.resource,code_challenge:createHash('sha256').update('a'.repeat(43)).digest('base64url'),code_challenge_method:'S256'});
    const page=await app.inject({method:'GET',url:'/oauth/authorize?'+params});
    assert.equal(page.statusCode,200,page.body);
    // Read a hidden OAuth form value from the authorization page.
    const hidden=name=>new RegExp('name="'+name+'" value="([^"]+)"').exec(page.body)[1];
    const cookie=page.cookies.map(({name,value})=>name+'='+value).join('; ');
    const login=await app.inject({method:'POST',url:'/oauth/login',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams({request:hidden('request'),csrf:hidden('csrf'),login:'human@example.com',password}).toString()});
    assert.equal(login.statusCode,password==='wrong password'?401:302,login.body);
   }
   await service.close();service=undefined;
  }
  c.users[0].passwordEnv='MCP_TEST_PASSWORD';
  fs.writeFileSync(file,JSON.stringify(c));assert.throws(()=>readRemoteConfig(file),/not both/);
  delete c.users[0].passwordHashEnv;delete c.users[0].passwordEnv;
  fs.writeFileSync(file,JSON.stringify(c));assert.throws(()=>readRemoteConfig(file),/require passwordEnv or passwordHashEnv/);
  c.users[0].passwordEnv='MCP_TEST_MISSING_PASSWORD';
  fs.writeFileSync(file,JSON.stringify(c));await assert.rejects(createRemoteApi(file),/Missing environment variable MCP_TEST_MISSING_PASSWORD/);
 } finally {
  await service?.close();fs.rmSync(root,{recursive:true,force:true});
  names.forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index];});
 }
});
