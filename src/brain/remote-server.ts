import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ApiServer, BaseAuthAdapter, MemAuthStore, JsonTokenStore, OAuthAuthorizationServer, OAuthPasswordLogin, OAuthProtocolError, verifyTotp } from '@technomoron/apicore-server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { BrainStore } from './store';
import { createBrainServer } from './server';
import { readRemoteConfig, validateRepositoryRoots, allowedGrant, repositoryPermissions, toolPermission, type RemoteConfig } from './remote-policy';
import { coversPattern } from './repositories';
import { createRepositoryDiscoveryServer, remoteRepositoryCatalog } from './repository-discovery';

type User = RemoteConfig['users'][number];
function secret(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error('Missing environment variable ' + name);
	return value;
}
function privateDirectory(directory: string): void {
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const stat = fs.lstatSync(directory);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' &&
		((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw new Error('Runtime directory must be private and owned by the server user');
}

/** A single process behind an HTTPS reverse proxy. Paths and identities come only from administrator configuration. */
export async function createRemoteApi(configFile: string) {
	const initial = readRemoteConfig(configFile);
	privateDirectory(initial.runtime);
	// Canonical roots prevent two configured repository IDs sharing storage through symlinks.
	validateRepositoryRoots(initial, true);
	for (const repo of initial.repositories) {
		if (!fs.statSync(repo.cwd).isDirectory()) throw new Error('Repository working directory is missing');
		const store = new BrainStore(repo.configRoot, repo.cwd);
		try { if ((repo.group && store.profile !== 'projects/' + repo.id) || (initial.dataRoot && store.pool !== repo.group)) throw new Error('Grouped repository requires its own registered project profile: ' + repo.id); }
		finally { store.close(); }
	}
	// Policy edits apply immediately. Storage locations, signing keys and client registration require a restart.
	const policy = () => {
		const current = readRemoteConfig(configFile);
		if (JSON.stringify(current.repositories) !== JSON.stringify(initial.repositories) || JSON.stringify(current.groups) !== JSON.stringify(initial.groups) || current.dataRoot !== initial.dataRoot || JSON.stringify(current.gitSync) !== JSON.stringify(initial.gitSync) || current.issuer !== initial.issuer || current.resource !== initial.resource) {
			throw new Error('Restart the remote server after changing repository locations or endpoints');
		}
		return current;
	};
	const sessions = new JsonTokenStore(path.join(initial.runtime, 'sessions.json'));
	const credentials = new MemAuthStore({ passkeys: false, tokenStore: sessions });
	const passwordHashes = new Map<string, string>();
	for (const user of initial.users) {
		if (user.kind !== 'human' || user.disabled || !user.passwordEnv) continue;
		const stored = await credentials.userStore.createUser({ login: user.subject, email: user.subject + '@brain.invalid', password: secret(user.passwordEnv) });
		passwordHashes.set(user.passwordEnv, credentials.getUserPasswordHash(stored));
	}
	class ConfigAuth extends BaseAuthAdapter<User, { subject: string }> {
		override async getUser(identifier: string | number) { return policy().users.find((u) => !u.disabled && (u.subject === String(identifier) || u.login === identifier)) ?? null; }
		override getUserId(user: User) { return user.subject; }
		// Resolve the configured password to the existing bcrypt verifier.
		override getUserPasswordHash(user: User) {
			if (user.kind !== 'human') return '';
			if (user.passwordHashEnv) return secret(user.passwordHashEnv);
			if (user.passwordEnv && passwordHashes.has(user.passwordEnv)) return passwordHashes.get(user.passwordEnv)!;
			throw new Error('Restart the remote server after changing password environment settings');
		}
		override filterUser(user: User) { return { subject: user.subject }; }
		override verifyPassword(password: string, hash: string) { return credentials.verifyPassword(password, hash); }
		override getClient(id: string) { return credentials.getClient(id); }
		override verifyClientSecret(client: Parameters<MemAuthStore['verifyClientSecret']>[0], value: string | null) { return credentials.verifyClientSecret(client, value); }
		override createAuthCode(input: Parameters<MemAuthStore['createAuthCode']>[0]) { return credentials.createAuthCode(input); }
		override consumeAuthCode(code: string, client: string) { return credentials.consumeAuthCode(code, client); }
	}
	for (const client of initial.clients) {
		await credentials.oauthStore.createClient({ clientId: client.id, redirectUris: client.redirectUris,
			...(client.secretEnv ? { clientSecret: secret(client.secretEnv) } : {}),
			scope: [...client.permissions, ...new Set([...initial.clients.flatMap((c) => c.repos), ...initial.repositories.map((r) => r.id)]
				.filter((repo) => client.repos.some((pattern) => coversPattern(pattern, repo))).map((repo) => 'repo:' + repo))] });
	}
	const api = new ApiServer({ authApi: false, origins: [], devMode: false }).authStorage(new ConfigAuth()).setTokenStore(sessions);
	const login = new OAuthPasswordLogin(api, { issuer: initial.issuer,
		allow: (subject, client, scopes, resources) => resources.length === 1 && resources[0] === initial.resource && allowedGrant(policy(), String(subject), client, scopes),
		verifySecondFactor: (value, code) => {
			const user = value as User;
			if (!user.totpSecretEnv) return true;
			const file = path.join(initial.runtime, 'mfa.json');
			const counters: Record<string, number> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
			const counter = verifyTotp(secret(user.totpSecretEnv), code, { after: counters[user.subject] });
			if (counter === null) return false;
			counters[user.subject] = counter;
			const temporary = file + '.' + randomUUID();
			fs.writeFileSync(temporary, JSON.stringify(counters), { flag: 'wx', mode: 0o600 });
			fs.renameSync(temporary, file);
			return true;
		}
	}).register();
	const attempts = new Map<string, { expires: number; count: number }>();
	const provider = new OAuthAuthorizationServer(api, { issuer: initial.issuer, resources: [initial.resource],
		rateLimit: (request) => {
			for (const [key, entry] of attempts) if (entry.expires <= Date.now()) attempts.delete(key);
			const entry = attempts.get(request.ip) ?? { count: 0, expires: Date.now() + 300000 };
			entry.count++;
			if (entry.count > 100 || attempts.size >= 10000) throw new OAuthProtocolError('slow_down', 'Too many authorization requests', 429);
			attempts.set(request.ip, entry);
		},
		scopes: [...new Set([...initial.clients.flatMap((c) => [...c.permissions, ...c.repos.map((p) => 'repo:' + p)]), ...initial.repositories.map((r) => 'repo:' + r.id)])],
		accessSecret: secret(initial.accessSecretEnv), refreshSecret: secret(initial.refreshSecretEnv),
		authorize: login.authorize,
		serviceAccounts: Object.fromEntries(initial.clients.filter((c) => c.kind === 'service').map((c) => [c.id, c.subject!])),
		validateGrant: (grant) => grant.resources.length === 1 && grant.resources[0] === initial.resource && allowedGrant(policy(), grant.userId, grant.clientId, grant.scopes)
	}).register();
	const resource = new URL(initial.resource);
	const endpoint = resource.pathname || '/';
	const metadataPath = '/.well-known/oauth-protected-resource' + (endpoint === '/' ? '' : endpoint);
	api.fastify.get(metadataPath, async () => provider.resourceMetadata(initial.resource));
	api.fastify.post(endpoint, async (request, reply) => {
		if (request.headers.origin && request.headers.origin !== resource.origin) return reply.code(403).send({ error: 'Invalid origin' });
		const authorization = request.headers.authorization;
		let claims;
		try {
			if (!authorization?.startsWith('Bearer ')) throw new Error('Missing bearer token');
			claims = await provider.verifyAccessToken(authorization.slice(7), initial.resource, ['read']);
		} catch {
			return reply.header('WWW-Authenticate', 'Bearer resource_metadata="' + resource.origin + metadataPath + '"').code(401).send({ error: 'invalid_token' });
		}
		const repository = request.headers['x-agent-repository'];
		if (repository !== undefined && typeof repository !== 'string') return reply.code(400).send({ error: 'Invalid X-Agent-Repository' });
		const current = policy();
		const user = current.users.find((u) => u.subject === claims.sub && !u.disabled);
		const client = current.clients.find((c) => c.id === claims.client_id);
		if (!user || !client || (user.kind === 'service' ? client.kind !== 'service' || client.subject !== user.subject : client.kind === 'service')) return reply.code(403).send({ error: 'Identity access denied' });
		const catalog = () => remoteRepositoryCatalog(policy(), claims.sub, claims.client_id, claims.scope.split(' '));
		let store: BrainStore | undefined;
		let server;
		if (repository === undefined) {
			server = createRepositoryDiscoveryServer(catalog);
		} else {
			const permissions = repositoryPermissions(current, claims.sub, claims.client_id, claims.scope.split(' '), repository);
			if (!permissions.has('read')) return reply.code(403).send({ error: 'Repository access denied' });
			const repo = initial.repositories.find((item) => item.id === repository)!;
			store = new BrainStore(repo.configRoot, repo.cwd);
			if ((repo.group && store.profile !== 'projects/' + repo.id) || (initial.dataRoot && store.pool !== repo.group)) { store.close(); return reply.code(503).send({ error: 'Repository profile changed; restore its registration before continuing' }); }
			// Require write access to every repository affected by a shared scope.
			const canWriteScope = (scope: 'project' | 'pool' | 'global') => {
				const scopes = claims.scope.split(' ');
				if (scope === 'project') return permissions.has('write');
				if (scope === 'global' && !initial.dataRoot) return initial.repositories.filter(member => repo.group ? member.group === repo.group : member.id === repo.id)
					.every(member => repositoryPermissions(policy(), claims.sub, claims.client_id, scopes, member.id).has('write'));
				if (scope === 'global') return scopes.includes('repo:*') && allowedGrant(policy(), claims.sub, claims.client_id, ['read','write','repo:*']);
				return !!repo.group && initial.repositories.filter(member => member.group === repo.group).every(member => repositoryPermissions(policy(), claims.sub, claims.client_id, scopes, member.id).has('write'));
			};
			server = createBrainServer(store, { sync: async (message) => {
				if (!initial.gitSync || !initial.dataRoot) throw new Error('Brain Git synchronization is not configured; changes remain on the server.');
				const scopes = ['projects/' + repository];
				if (repo.group && canWriteScope('pool')) scopes.push('pools/' + repo.group);
				if (canWriteScope('global')) scopes.push('global');
				return new Promise((resolve, reject) => {
					const child = execFile(process.execPath, [path.resolve(__dirname, '../../ops/config-sync.cjs')], { timeout: 180000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
						if (error) reject(new Error(stderr.trim() || error.message));
						else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid Brain sync response')); } }
					});
					child.stdin?.end(JSON.stringify({ ...initial.gitSync, dataRoot: initial.dataRoot, scopes, reviews: permissions.has('review'), message }));
				});
			}, repository, group: repo.group, repositories: catalog, allowScopeWrite: (scope) => {
				return scope === 'project' || (scope === 'default' ? !initial.dataRoot : canWriteScope(scope));
			}, allowTool: (name) => { const required = toolPermission(name); return required !== null && permissions.has(required); } });
		}
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
		reply.hijack();
		try { await server.connect(transport); await transport.handleRequest(request.raw, reply.raw, request.body); }
		finally { await server.close(); store?.close(); }
	});
	api.fastify.route({ method: ['GET','DELETE'], url: endpoint, handler: async (_request, reply) => reply.code(405).send() });
	return { api, provider, config: initial, close: () => api.fastify.close() };
}

export async function serveRemote(configFile: string) {
	const service = await createRemoteApi(configFile);
	await service.api.fastify.listen(service.config.listen.socket ? { path: service.config.listen.socket } : { host: '127.0.0.1', port: service.config.listen.port });
	if (service.config.listen.socket && process.platform !== 'win32') fs.chmodSync(service.config.listen.socket, 0o600);
	return service;
}
