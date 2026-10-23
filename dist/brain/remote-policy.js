"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.remoteConfigSchema = exports.permission = void 0;
exports.readRemoteConfig = readRemoteConfig;
exports.validateRepositoryRoots = validateRepositoryRoots;
exports.allowedGrant = allowedGrant;
exports.repositoryPermissions = repositoryPermissions;
exports.toolPermission = toolPermission;
const fs = require("node:fs");
const path = require("node:path");
const jsonc_parser_1 = require("jsonc-parser");
const zod_1 = require("zod");
const repositories_1 = require("./repositories");
const envName = zod_1.z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
const absolute = zod_1.z.string().refine(path.isAbsolute, 'Use an absolute path');
const https = zod_1.z.string().url().refine((value) => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; });
exports.permission = zod_1.z.enum(['read', 'write', 'review']);
exports.remoteConfigSchema = zod_1.z.object({
    issuer: https, resource: https, runtime: absolute,
    dataRoot: absolute.optional(),
    gitSync: zod_1.z.object({ catalog: absolute, state: absolute }).strict().optional(),
    accessSecretEnv: envName.default('MCP_OAUTH_ACCESS_SECRET'), refreshSecretEnv: envName.default('MCP_OAUTH_REFRESH_SECRET'),
    listen: zod_1.z.object({ host: zod_1.z.literal('127.0.0.1').default('127.0.0.1'), port: zod_1.z.number().int().min(1).max(65535).default(3000), socket: absolute.optional() }).strict().default({ host: '127.0.0.1', port: 3000 }),
    users: zod_1.z.array(zod_1.z.object({ subject: zod_1.z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/), login: zod_1.z.string().min(1).max(200),
        kind: zod_1.z.enum(['human', 'service']).default('human'), passwordEnv: envName.optional(), passwordHashEnv: envName.optional(), totpSecretEnv: envName.optional(), disabled: zod_1.z.boolean().default(false) }).strict()),
    clients: zod_1.z.array(zod_1.z.object({ id: zod_1.z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/), kind: zod_1.z.enum(['public', 'confidential', 'service']).default('public'),
        secretEnv: envName.optional(), subject: zod_1.z.string().optional(), redirectUris: zod_1.z.array(zod_1.z.string().url()).default([]),
        repos: zod_1.z.array(repositories_1.repositoryPattern).min(1), permissions: zod_1.z.array(exports.permission).min(1) }).strict()),
    access: zod_1.z.array(zod_1.z.object({ subject: zod_1.z.string(), repos: zod_1.z.array(repositories_1.repositoryPattern).min(1), permissions: zod_1.z.array(exports.permission).min(1) }).strict()),
    groups: zod_1.z.array(zod_1.z.object({ id: zod_1.z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/), configRoot: absolute }).strict()).default([]),
    repositories: zod_1.z.array(zod_1.z.object({ id: repositories_1.repositoryId, configRoot: absolute, cwd: absolute, group: zod_1.z.string().optional() }).strict())
}).strict();
// Validate remote configuration and its identity and repository relationships.
function readRemoteConfig(file) {
    const errors = [];
    const value = (0, jsonc_parser_1.parse)(fs.readFileSync(file, 'utf8'), errors, { allowTrailingComma: true });
    if (errors.length)
        throw new Error('Invalid remote config JSONC');
    const config = exports.remoteConfigSchema.parse(value);
    for (const values of [config.users.map((u) => u.subject), config.users.map((u) => u.login), config.clients.map((c) => c.id), config.repositories.map((r) => r.id)]) {
        if (new Set(values).size !== values.length)
            throw new Error('Remote identities, logins, clients and repository IDs must be unique');
    }
    for (const user of config.users) {
        if (config.users.some((other) => other.subject !== user.subject && other.subject === user.login))
            throw new Error('Logins must not alias another subject');
        if (user.passwordEnv && user.passwordHashEnv)
            throw new Error('Choose passwordEnv or passwordHashEnv, not both');
        if (!user.disabled && user.kind === 'human' && !user.passwordHashEnv && !user.passwordEnv)
            throw new Error('Human users require passwordEnv or passwordHashEnv');
    }
    for (const client of config.clients) {
        if (client.kind !== 'public' && !client.secretEnv)
            throw new Error('Confidential and service clients require secretEnv');
        if (client.kind === 'public' && client.secretEnv)
            throw new Error('Public clients cannot hold a secret');
        if (client.kind !== 'service' && !client.redirectUris.length)
            throw new Error('Interactive clients need a registered redirect URI');
        if (client.kind === 'service' && !config.users.some((u) => u.subject === client.subject && u.kind === 'service'))
            throw new Error('Service client needs a configured service subject');
    }
    validateRepositoryRoots(config);
    if (config.access.some((rule) => !config.users.some((user) => user.subject === rule.subject)))
        throw new Error('Access rule references an unknown subject');
    return config;
}
/** A declared group may share a root; unrelated groups and repositories must remain isolated. */
function validateRepositoryRoots(config, canonical = false) {
    if (config.dataRoot) {
        // Resolve a configured root, following symlinks only for canonical validation.
        const resolve = (value) => canonical ? fs.realpathSync(value) : path.resolve(value);
        if (config.repositories.some((repo) => resolve(repo.configRoot) !== resolve(config.dataRoot)) || config.groups.some((group) => resolve(group.configRoot) !== resolve(config.dataRoot)))
            throw new Error('All repositories and pools must use the central dataRoot');
        if (new Set(config.groups.map((group) => group.id)).size !== config.groups.length || config.repositories.some((repo) => repo.group && !config.groups.some((group) => group.id === repo.group)))
            throw new Error('Pool registration is invalid');
        return;
    }
    if (new Set(config.groups.map((g) => g.id)).size !== config.groups.length)
        throw new Error('Group IDs must be unique');
    // Resolve a configured root, following symlinks only for canonical validation.
    const resolve = (value) => canonical ? fs.realpathSync(value) : path.resolve(value);
    for (const repo of config.repositories)
        if (repo.group !== undefined) {
            const group = config.groups.find((g) => g.id === repo.group);
            if (!group || resolve(repo.configRoot) !== resolve(group.configRoot))
                throw new Error('Grouped repository must use its declared group data root');
        }
    const roots = [...config.groups.map((g) => ({ identity: 'group:' + g.id, root: resolve(g.configRoot) })),
        ...config.repositories.filter((r) => !r.group).map((r) => ({ identity: 'repo:' + r.id, root: resolve(r.configRoot) }))];
    for (let i = 0; i < roots.length; i++)
        for (let j = i + 1; j < roots.length; j++) {
            const a = roots[i].root, b = roots[j].root;
            // Check whether one storage root contains another.
            const overlaps = (from, to) => { const relative = path.relative(from, to); return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); };
            if (overlaps(a, b) || overlaps(b, a))
                throw new Error('Repository and group data roots must be separate and non-overlapping');
        }
}
// Check requested OAuth scopes against the current user and client grants.
function allowedGrant(config, subject, clientId, scopes) {
    const user = config.users.find((u) => u.subject === subject && !u.disabled);
    const client = config.clients.find((c) => c.id === clientId);
    if (!user || !client || (user.kind === 'service' ? client.kind !== 'service' || client.subject !== subject : client.kind === 'service'))
        return false;
    const operations = scopes.filter((scope) => exports.permission.safeParse(scope).success);
    const repos = scopes.filter((scope) => scope.startsWith('repo:')).map((scope) => scope.slice(5));
    if (!operations.includes('read') || !repos.length || scopes.length !== operations.length + repos.length)
        return false;
    return repos.every((repo) => repositories_1.repositoryPattern.safeParse(repo).success && client.repos.some((pattern) => (0, repositories_1.coversPattern)(pattern, repo)) &&
        operations.every((operation) => client.permissions.includes(operation) && config.access.some((rule) => rule.subject === subject &&
            rule.permissions.includes(operation) && rule.repos.some((pattern) => (0, repositories_1.coversPattern)(pattern, repo)))));
}
// Intersect current user, client and token permissions for one repository.
function repositoryPermissions(config, subject, clientId, scopes, repo) {
    const client = config.clients.find((c) => c.id === clientId);
    const user = config.users.find((u) => u.subject === subject && !u.disabled);
    if (!config.repositories.some((r) => r.id === repo) || !user || !client ||
        (user.kind === 'service' ? client.kind !== 'service' || client.subject !== subject : client.kind === 'service') ||
        !client.repos.some((p) => (0, repositories_1.matchesRepository)(p, repo)) || !scopes.some((scope) => scope.startsWith('repo:') && (0, repositories_1.matchesRepository)(scope.slice(5), repo)))
        return new Set();
    return new Set(config.access.filter((rule) => rule.subject === subject && rule.repos.some((p) => (0, repositories_1.matchesRepository)(p, repo)))
        .flatMap((rule) => rule.permissions).filter((op) => scopes.includes(op) && client.permissions.includes(op)));
}
const readTools = new Set(['list_repositories', 'list_repository_groups', 'brain_status', 'get_context', 'search_knowledge', 'list_knowledge', 'knowledge_history', 'get_knowledge', 'list_skills', 'get_skill', 'review_context', 'review_list', 'review_get', 'review_history', 'todo_list', 'todo_get']);
const reviewTools = new Set(['review_create', 'review_update', 'resolve_review']);
// Classify a tool by required permission and reject unsupported remote tools.
function toolPermission(name) {
    if (readTools.has(name))
        return 'read';
    if (reviewTools.has(name))
        return 'review';
    if (['sync_status', 'todo_import', 'todo_sync', 'review_archive'].includes(name))
        return null;
    return ['brain_sync', 'brain_flush', 'sync', 'flush', 'remember', 'amend_knowledge', 'promote', 'deprecate_knowledge', 'todo_add', 'todo_update', 'todo_complete'].includes(name) ? 'write' : null;
}
