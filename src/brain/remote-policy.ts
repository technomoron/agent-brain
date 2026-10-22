import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { z } from 'zod';
import { repositoryId, repositoryPattern, matchesRepository, coversPattern } from './repositories';

const envName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
const absolute = z.string().refine(path.isAbsolute, 'Use an absolute path');
const https = z.string().url().refine((value) => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; });
export const permission = z.enum(['read', 'write', 'review']);
export type Permission = z.infer<typeof permission>;
export const remoteConfigSchema = z.object({
	issuer: https, resource: https, runtime: absolute,
	dataRoot: absolute.optional(),
	gitSync: z.object({ catalog: absolute, state: absolute }).strict().optional(),
	accessSecretEnv: envName.default('MCP_OAUTH_ACCESS_SECRET'), refreshSecretEnv: envName.default('MCP_OAUTH_REFRESH_SECRET'),
	listen: z.object({ host: z.literal('127.0.0.1').default('127.0.0.1'), port: z.number().int().min(1).max(65535).default(3000), socket: absolute.optional() }).strict().default({ host: '127.0.0.1', port: 3000 }),
	users: z.array(z.object({ subject: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/), login: z.string().min(1).max(200),
		kind: z.enum(['human', 'service']).default('human'), passwordHashEnv: envName.optional(), totpSecretEnv: envName.optional(), disabled: z.boolean().default(false) }).strict()),
	clients: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/), kind: z.enum(['public', 'confidential', 'service']).default('public'),
		secretEnv: envName.optional(), subject: z.string().optional(), redirectUris: z.array(z.string().url()).default([]),
		repos: z.array(repositoryPattern).min(1), permissions: z.array(permission).min(1) }).strict()),
	access: z.array(z.object({ subject: z.string(), repos: z.array(repositoryPattern).min(1), permissions: z.array(permission).min(1) }).strict()),
	groups: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/), configRoot: absolute }).strict()).default([]),
	repositories: z.array(z.object({ id: repositoryId, configRoot: absolute, cwd: absolute, group: z.string().optional() }).strict())
}).strict();
export type RemoteConfig = z.infer<typeof remoteConfigSchema>;

export function readRemoteConfig(file: string): RemoteConfig {
	const errors: ParseError[] = [];
	const value: unknown = parseJsonc(fs.readFileSync(file, 'utf8'), errors, { allowTrailingComma: true });
	if (errors.length) throw new Error('Invalid remote config JSONC');
	const config = remoteConfigSchema.parse(value);
	for (const values of [config.users.map((u) => u.subject), config.users.map((u) => u.login), config.clients.map((c) => c.id), config.repositories.map((r) => r.id)]) {
		if (new Set(values).size !== values.length) throw new Error('Remote identities, logins, clients and repository IDs must be unique');
	}
	for (const user of config.users) {
		if (config.users.some((other) => other.subject !== user.subject && other.subject === user.login)) throw new Error('Logins must not alias another subject');
		if (!user.disabled && user.kind === 'human' && !user.passwordHashEnv) throw new Error('Human users require passwordHashEnv');
	}
	for (const client of config.clients) {
		if (client.kind !== 'public' && !client.secretEnv) throw new Error('Confidential and service clients require secretEnv');
		if (client.kind === 'public' && client.secretEnv) throw new Error('Public clients cannot hold a secret');
		if (client.kind !== 'service' && !client.redirectUris.length) throw new Error('Interactive clients need a registered redirect URI');
		if (client.kind === 'service' && !config.users.some((u) => u.subject === client.subject && u.kind === 'service')) throw new Error('Service client needs a configured service subject');
	}
	validateRepositoryRoots(config);
	if (config.access.some((rule) => !config.users.some((user) => user.subject === rule.subject))) throw new Error('Access rule references an unknown subject');
	return config;
}

/** A declared group may share a root; unrelated groups and repositories must remain isolated. */
export function validateRepositoryRoots(config: RemoteConfig, canonical = false): void {
	if (config.dataRoot) {
		const resolve = (value: string) => canonical ? fs.realpathSync(value) : path.resolve(value);
		if (config.repositories.some((repo) => resolve(repo.configRoot) !== resolve(config.dataRoot!)) || config.groups.some((group) => resolve(group.configRoot) !== resolve(config.dataRoot!))) throw new Error('All repositories and pools must use the central dataRoot');
		if (new Set(config.groups.map((group) => group.id)).size !== config.groups.length || config.repositories.some((repo) => repo.group && !config.groups.some((group) => group.id === repo.group))) throw new Error('Pool registration is invalid');
		return;
	}
	if (new Set(config.groups.map((g) => g.id)).size !== config.groups.length) throw new Error('Group IDs must be unique');
	const resolve = (value: string) => canonical ? fs.realpathSync(value) : path.resolve(value);
	for (const repo of config.repositories) if (repo.group !== undefined) {
		const group = config.groups.find((g) => g.id === repo.group);
		if (!group || resolve(repo.configRoot) !== resolve(group.configRoot)) throw new Error('Grouped repository must use its declared group data root');
	}
	const roots = [...config.groups.map((g) => ({ identity: 'group:' + g.id, root: resolve(g.configRoot) })),
		...config.repositories.filter((r) => !r.group).map((r) => ({ identity: 'repo:' + r.id, root: resolve(r.configRoot) }))];
	for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
		const a = roots[i]!.root, b = roots[j]!.root;
		const overlaps = (from: string, to: string) => { const relative = path.relative(from, to); return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); };
		if (overlaps(a, b) || overlaps(b, a)) throw new Error('Repository and group data roots must be separate and non-overlapping');
	}
}

export function allowedGrant(config: RemoteConfig, subject: string, clientId: string, scopes: readonly string[]): boolean {
	const user = config.users.find((u) => u.subject === subject && !u.disabled);
	const client = config.clients.find((c) => c.id === clientId);
	if (!user || !client || (user.kind === 'service' ? client.kind !== 'service' || client.subject !== subject : client.kind === 'service')) return false;
	const operations = scopes.filter((scope) => permission.safeParse(scope).success) as Permission[];
	const repos = scopes.filter((scope) => scope.startsWith('repo:')).map((scope) => scope.slice(5));
	if (!operations.includes('read') || !repos.length || scopes.length !== operations.length + repos.length) return false;
	return repos.every((repo) => repositoryPattern.safeParse(repo).success && client.repos.some((pattern) => coversPattern(pattern, repo)) &&
		operations.every((operation) => client.permissions.includes(operation) && config.access.some((rule) => rule.subject === subject &&
			rule.permissions.includes(operation) && rule.repos.some((pattern) => coversPattern(pattern, repo)))));
}

export function repositoryPermissions(config: RemoteConfig, subject: string, clientId: string, scopes: string[], repo: string): Set<Permission> {
	const client = config.clients.find((c) => c.id === clientId);
	const user = config.users.find((u) => u.subject === subject && !u.disabled);
	if (!config.repositories.some((r) => r.id === repo) || !user || !client ||
		(user.kind === 'service' ? client.kind !== 'service' || client.subject !== subject : client.kind === 'service') ||
		!client.repos.some((p) => matchesRepository(p, repo)) || !scopes.some((scope) => scope.startsWith('repo:') && matchesRepository(scope.slice(5), repo))) return new Set();
	return new Set(config.access.filter((rule) => rule.subject === subject && rule.repos.some((p) => matchesRepository(p, repo)))
		.flatMap((rule) => rule.permissions).filter((op) => scopes.includes(op) && client.permissions.includes(op)));
}

const readTools = new Set(['list_repositories','list_repository_groups','brain_status','get_context','search_knowledge','list_knowledge','knowledge_history','get_knowledge','list_skills','get_skill','review_context','review_list','review_get','review_history','todo_list','todo_get']);
const reviewTools = new Set(['review_create','review_update','resolve_review']);
export function toolPermission(name: string): Permission | null {
	if (readTools.has(name)) return 'read';
	if (reviewTools.has(name)) return 'review';
	if (['sync_status','todo_import','todo_sync','review_archive'].includes(name)) return null;
	return ['brain_sync','brain_flush','sync','flush','remember','amend_knowledge','promote','deprecate_knowledge','todo_add','todo_update','todo_complete'].includes(name) ? 'write' : null;
}
