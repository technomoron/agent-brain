'use strict';
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { manifest, readSnapshot, fileContents, coreSkills } = require('./config-policy.cjs');

// Only canonical data is exported. Client settings, server paths and policy stay in Git/admin configuration.
function exportPlan(base, live, remote, scopes, reviews = true) {
 const changes = {}, conflicts = [];
 const eligible = name => !coreSkills.has(/\/skills\/([^/]+)\//.exec(name)?.[1]) && scopes.some(scope => name.startsWith(scope + '/')) &&
  !/\/(?:config\.yaml|agent-run\.jsonc|review\.jsonc)$/.test(name) &&
  (reviews || !/\/(?:reviews\/|review-history\.jsonl$|review-counters\.json$)/.test(name));
 for (const name of new Set([...Object.keys(base), ...Object.keys(live)])) {
  if (!eligible(name) || live[name] === base[name] || live[name] === remote[name]) continue;
  if (remote[name] !== base[name]) conflicts.push(name);
  else changes[name] = live[name] ?? null;
 }
 return { changes, conflicts };
}
function sync({ dataRoot, catalog, state, scopes, reviews = true, message }) {
 fs.mkdirSync(state, { recursive: true, mode: 0o700 });
 const lock = path.join(state, 'catalog.lock');
 try { fs.mkdirSync(lock, { mode: 0o700 }); }
 catch (error) { if (error.code === 'EEXIST') throw Error('Another Brain sync or configuration deployment is running; retry sync.'); throw error; }
 let checkout;
 const git = (root, args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', timeout: 60000, maxBuffer: 100 * 1024 * 1024,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
 }).trimEnd();
 try {
  const baseline = JSON.parse(fs.readFileSync(path.join(state, 'baseline.json'), 'utf8')).files;
  const deployment = createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
  const exportFile = path.join(state, 'export-baseline.json');
  let exported = fs.existsSync(exportFile) ? JSON.parse(fs.readFileSync(exportFile, 'utf8')) : {};
  if (exported.deployment !== deployment) exported = { deployment };
  const saveExport = () => {
   const temporary = exportFile + '.' + randomUUID();
   try { fs.writeFileSync(temporary, JSON.stringify(exported), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, exportFile); }
   finally { fs.rmSync(temporary, { force: true }); }
  };
  const origin = git(catalog, ['remote', 'get-url', 'origin']);
  const exports = path.join(state, 'exports'); fs.mkdirSync(exports, { recursive: true, mode: 0o700 });
  checkout = fs.mkdtempSync(path.join(exports, 'sync-'));
  git(catalog, ['clone', '--quiet', '--single-branch', '--branch', 'main', '--', origin, checkout]);
  // Recover a successful push even if its writer crashed before acknowledging it.
  if (exported.pending) {
   let pushed = false;
   try { git(checkout, ['merge-base', '--is-ancestor', exported.pending.commit, 'HEAD']); pushed = true; } catch {}
   if (pushed) exported.committed = exported.pending;
   delete exported.pending;
   saveExport();
  }
  const selection = manifest(JSON.parse(fs.readFileSync(path.join(checkout, '.brain-deploy.json'), 'utf8')));
  const allowed = new Set(['global', ...selection.pools.map(p => 'pools/' + p), ...selection.repositories.map(r => 'projects/' + r.id)]);
  if (!scopes.length || scopes.some(s => !allowed.has(s))) throw Error('Sync scope is not registered in the configuration repository');
  const writeLock = path.join(dataRoot, 'runtime', 'brain-write.lock');
  let fd;
  try { fd = fs.openSync(writeLock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw Error('Another Brain write is running; retry sync.'); throw error; }
  let live;
  try { fs.writeSync(fd, String(process.pid)); live = readSnapshot(dataRoot, selection, { required: false }); }
  finally { fs.closeSync(fd); fs.unlinkSync(writeLock); }
  const remote = readSnapshot(checkout, selection);
  const plan = exportPlan(exported.committed?.files ?? baseline, live, remote, scopes, reviews);
  if (plan.conflicts.length) throw Error('Brain/Git conflict; live changes retained. Reconcile: ' + plan.conflicts.join(', '));
  const names = Object.keys(plan.changes);
  for (const [name, value] of Object.entries(plan.changes)) {
   const file = path.join(checkout, ...name.split('/'));
   if (value === null) fs.rmSync(file, { force: true });
   else { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, fileContents(value), { mode: 0o600 }); }
  }
  let commit = null;
  if (names.length) {
   git(checkout, ['add', '--', ...names]);
   git(checkout, ['-c', 'user.name=' + git(catalog, ['config', 'user.name']), '-c', 'user.email=' + git(catalog, ['config', 'user.email']), 'commit', '-m', message ?? `Save Brain knowledge (${names.length} ${names.length === 1 ? 'file' : 'files'})`]);
   commit = git(checkout, ['rev-parse', 'HEAD']);
   const files = { ...(exported.committed?.files ?? baseline) };
   for (const [name, value] of Object.entries(plan.changes)) {
    if (value === null) delete files[name];
    else files[name] = value;
   }
   // Keep the prior baseline until Git confirms the pending commit reached main.
   exported.pending = { commit, files };
   saveExport();
   // Never force. A concurrent Git push is reported and the next sync starts from fresh main.
   git(checkout, ['push', 'origin', 'HEAD:refs/heads/main']);
   exported.committed = exported.pending;
   delete exported.pending;
   saveExport();
  }
  fs.rmSync(checkout, { recursive: true, force: true }); checkout = undefined;
  return { state: 'synced', files: names.length, commit, steps: [names.length ? 'Brain changes committed and pushed.' : 'No Brain changes to push.'] };
 } catch (error) {
  throw Error((error.message ?? String(error)) + (checkout ? '\nExport retained at ' + checkout + '; live Brain data is unchanged. Retry sync after fixing the cause.' : ''));
 } finally { fs.rmdirSync(lock); }
}
module.exports = { exportPlan, sync };
if (require.main === module) {
 let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => input += c);
 process.stdin.on('end', () => { try { console.log(JSON.stringify(sync(JSON.parse(input)))); } catch(error) { console.error(error.message); process.exitCode = 1; } });
}
