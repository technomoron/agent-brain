"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubReviews = exports.reviewInput = void 0;
exports.githubReviews = githubReviews;
const fs = require("node:fs");
const node_crypto_1 = require("node:crypto");
const jsonc_parser_1 = require("jsonc-parser");
const zod_1 = require("zod");
const repositories_1 = require("./repositories");
const config_1 = require("./config");
const store_1 = require("./store");
const configSchema = zod_1.z.object({ backend: zod_1.z.literal('github'), repository: repositories_1.repositoryId.optional(),
    tokenEnv: zod_1.z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default('GITHUB_TOKEN'), writesEnabled: zod_1.z.boolean().default(false) }).strict();
exports.reviewInput = zod_1.z.object({ key: zod_1.z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/).max(200),
    title: zod_1.z.string().trim().min(1).max(250), content: zod_1.z.string().trim().min(1).max(40000), severity: store_1.severitySchema,
    applies_to: zod_1.z.array(zod_1.z.string().max(500)).max(100).default([]), confirmed: zod_1.z.literal(true) }).strict();
const metadata = zod_1.z.object({ key: zod_1.z.string(), severity: store_1.severitySchema, applies_to: zod_1.z.array(zod_1.z.string()) });
const issueSchema = zod_1.z.object({ number: zod_1.z.number().int().positive(), title: zod_1.z.string(), body: zod_1.z.string().nullable(),
    state: zod_1.z.enum(['open', 'closed']), state_reason: zod_1.z.string().nullable().optional(), html_url: zod_1.z.string().url(),
    updated_at: zod_1.z.string(), pull_request: zod_1.z.unknown().optional() });
const hash = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
const start = '<!-- agent-mcp-review:start -->';
const end = '<!-- agent-mcp-review:end -->';
class GithubReviews {
    constructor(store, config, repository) {
        this.store = store;
        this.config = config;
        this.repository = repository;
    }
    async request(route, method = 'GET', body) {
        const token = process.env[this.config.tokenEnv];
        if (!token)
            throw new Error('Set ' + this.config.tokenEnv + ' for GitHub reviews');
        const response = await fetch('https://api.github.com/repos/' + this.repository + '/issues' + route, {
            method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { accept: 'application/vnd.github+json',
                'content-type': 'application/json', 'user-agent': 'agent-mcp', authorization: 'Bearer ' + token,
                'X-GitHub-Api-Version': '2026-03-10' }, ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (!response.ok)
            throw new Error('GitHub review request failed with HTTP ' + response.status);
        const text = await response.text();
        if (text.length > 4 * 1024 * 1024)
            throw new Error('GitHub response exceeds 4 MiB');
        return JSON.parse(text);
    }
    data(issue) {
        if (issue.pull_request)
            return null;
        const body = issue.body ?? '';
        const match = /<!-- agent-mcp-meta:([A-Za-z0-9_-]+) -->/.exec(body);
        if (!match || !body.includes(start) || !body.includes(end))
            return null;
        let decoded;
        try {
            decoded = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
        }
        catch {
            return null;
        }
        const parsed = metadata.safeParse(decoded);
        if (!parsed.success)
            return null;
        return { ...parsed.data, id: 'github:' + this.repository + '#' + issue.number, finding: '#' + issue.number,
            title: issue.title, content: body, state: issue.state === 'open' ? 'open' : issue.state_reason === 'not_planned' ? 'wontfix' : 'fixed',
            url: issue.html_url, revision: hash(JSON.stringify(issue)), backend: 'github' };
    }
    async list(state = 'open') {
        const found = [];
        for (let page = 1; page <= 100; page++) {
            const issues = zod_1.z.array(issueSchema).parse(await this.request('?state=' + state + '&per_page=100&page=' + page));
            for (const issue of issues) {
                const item = this.data(issue);
                if (item)
                    found.push(item);
            }
            if (issues.length < 100)
                return found.sort((a, b) => ['critical', 'high', 'medium', 'low'].indexOf(a.severity) - ['critical', 'high', 'medium', 'low'].indexOf(b.severity));
        }
        throw new Error('GitHub review listing exceeds 100 pages; narrow the repository backlog before retrying');
    }
    number(id) {
        const prefix = 'github:' + this.repository + '#';
        const number = id.startsWith(prefix) ? id.slice(prefix.length) : id.replace(/^#/, '');
        if (!/^[1-9][0-9]*$/.test(number))
            throw new Error('Issue must belong to the configured repository');
        return number;
    }
    async get(id) {
        const item = this.data(issueSchema.parse(await this.request('/' + this.number(id))));
        if (!item)
            throw new Error('Issue is not an agent-mcp review finding');
        return item;
    }
    async locked(work) {
        if (!this.config.writesEnabled)
            throw new Error('GitHub review writes are disabled; configure writesEnabled explicitly');
        const lock = this.store.safePath('runtime', 'github-review.lock');
        const descriptor = fs.openSync(lock, 'wx', 0o600);
        try {
            return await work();
        }
        finally {
            fs.closeSync(descriptor);
            fs.unlinkSync(lock);
        }
    }
    block(input) {
        if (input.content.includes('<!-- agent-mcp-'))
            throw new Error('Finding content contains a reserved marker');
        const encoded = Buffer.from(JSON.stringify({ key: input.key, severity: input.severity, applies_to: input.applies_to })).toString('base64url');
        return start + '\n<!-- agent-mcp-meta:' + encoded + ' -->\nSeverity: ' + input.severity + '\n\n' + input.content + '\n' + end;
    }
    async create(input) {
        input = exports.reviewInput.parse(input);
        return this.locked(async () => {
            const file = this.store.safePath('runtime', 'github-review-keys-' + hash(this.repository) + '.json');
            const keys = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
            if (Object.prototype.hasOwnProperty.call(keys, input.key)) {
                const existing = await this.get(keys[input.key]);
                if (existing.key !== input.key)
                    throw new Error('Stored review retry key does not match its GitHub issue');
                return { ...existing, created: false };
            }
            const existing = (await this.list('all')).find((item) => item.key === input.key);
            if (existing)
                return { ...existing, created: false };
            const item = this.data(issueSchema.parse(await this.request('', 'POST', { title: input.title, body: this.block(input) })));
            if (!item)
                throw new Error('GitHub returned an invalid review finding');
            Object.defineProperty(keys, input.key, { value: item.id, enumerable: true, configurable: true, writable: true });
            fs.writeFileSync(file + '.tmp', JSON.stringify(keys), { mode: 0o600 });
            fs.renameSync(file + '.tmp', file);
            return { ...item, created: true };
        });
    }
    async update(id, revision, changes) {
        return this.locked(async () => {
            const current = await this.get(id);
            if (current.revision !== revision)
                throw new Error('GitHub finding changed; read it again before updating');
            const managed = current.content.slice(current.content.indexOf(start), current.content.indexOf(end));
            const block = this.block({ ...current, ...changes, content: changes.content ?? managed.slice(managed.indexOf('\n\n') + 2).trim() });
            const body = current.content.slice(0, current.content.indexOf(start)) + block + current.content.slice(current.content.indexOf(end) + end.length);
            const issue = issueSchema.parse(await this.request('/' + this.number(id), 'PATCH', { title: changes.title ?? current.title, body }));
            return this.data(issue);
        });
    }
    async resolve(id, revision, state, reason) {
        return this.locked(async () => {
            const current = await this.get(id);
            if (current.revision !== revision)
                throw new Error('GitHub finding changed; read it again before closing');
            const issue = issueSchema.parse(await this.request('/' + this.number(id), 'PATCH', {
                state: 'closed', state_reason: state === 'fixed' ? 'completed' : 'not_planned', body: current.content + '\n\nResolution: ' + reason
            }));
            return this.data(issue);
        });
    }
}
exports.GithubReviews = GithubReviews;
function githubReviews(store) {
    const file = store.safePath(store.profile ?? 'default', 'review.jsonc');
    if (!fs.existsSync(file))
        return null;
    const errors = [];
    const config = configSchema.parse((0, jsonc_parser_1.parse)(store.read(file), errors));
    if (errors.length)
        throw new Error('Invalid review.jsonc');
    const project = (0, config_1.listBrainProjects)(store.configRoot).find((item) => item.profile === store.profile);
    const repository = config.repository ?? (project?.repository?.url ? (0, repositories_1.githubRepository)(project.repository.url) : null);
    if (!repository)
        throw new Error('GitHub reviews need an explicit repository or a registered GitHub remote');
    return new GithubReviews(store, config, repository);
}
