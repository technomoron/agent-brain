import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { z } from 'zod';
import { repositoryId, githubRepository } from './repositories';
import { listBrainProjects } from './config';
import { BrainStore, severitySchema } from './store';

const configSchema = z.object({ backend: z.literal('github'), repository: repositoryId.optional(),
	tokenEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default('GITHUB_TOKEN'), writesEnabled: z.boolean().default(false) }).strict();
export const reviewInput = z.object({ key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/).max(200),
	title: z.string().trim().min(1).max(250), content: z.string().trim().min(1).max(40000), severity: severitySchema,
	applies_to: z.array(z.string().max(500)).max(100).default([]), confirmed: z.literal(true) }).strict();
const metadata = z.object({ key: z.string(), severity: severitySchema, applies_to: z.array(z.string()) });
const issueSchema = z.object({ number: z.number().int().positive(), title: z.string(), body: z.string().nullable(),
	state: z.enum(['open', 'closed']), state_reason: z.string().nullable().optional(), html_url: z.string().url(),
	updated_at: z.string(), pull_request: z.unknown().optional() });
type Issue = z.infer<typeof issueSchema>;
// Hash review content for revisions and repository-specific retry files.
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const start = '<!-- agent-mcp-review:start -->';
const end = '<!-- agent-mcp-review:end -->';

export class GithubReviews {
	readonly repository: string;
	// Bind the review backend to its store, configuration and GitHub repository.
	constructor(private readonly store: BrainStore, private readonly config: z.infer<typeof configSchema>, repository: string) { this.repository = repository; }
	// Send an authenticated GitHub issue request with time and size limits.
	private async request(route: string, method = 'GET', body?: unknown): Promise<unknown> {
		const token = process.env[this.config.tokenEnv];
		if (!token) throw new Error('Set ' + this.config.tokenEnv + ' for GitHub reviews');
		const response = await fetch('https://api.github.com/repos/' + this.repository + '/issues' + route, {
			method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { accept: 'application/vnd.github+json',
				'content-type': 'application/json', 'user-agent': 'agent-brain', authorization: 'Bearer ' + token,
				'X-GitHub-Api-Version': '2026-03-10' }, ...(body ? { body: JSON.stringify(body) } : {})
		});
		if (!response.ok) throw new Error('GitHub review request failed with HTTP ' + response.status);
		const text = await response.text();
		if (text.length > 4 * 1024 * 1024) throw new Error('GitHub response exceeds 4 MiB');
		return JSON.parse(text);
	}
	// Extract managed review metadata from an ordinary GitHub issue.
	private data(issue: Issue) {
		if (issue.pull_request) return null;
		const body = issue.body ?? '';
		const match = /<!-- agent-mcp-meta:([A-Za-z0-9_-]+) -->/.exec(body);
		if (!match || !body.includes(start) || !body.includes(end)) return null;
		let decoded: unknown;
		try { decoded = JSON.parse(Buffer.from(match[1]!, 'base64url').toString('utf8')); } catch { return null; }
		const parsed = metadata.safeParse(decoded);
		if (!parsed.success) return null;
		return { ...parsed.data, id: 'github:' + this.repository + '#' + issue.number, finding: '#' + issue.number,
			title: issue.title, content: body, state: issue.state === 'open' ? 'open' : issue.state_reason === 'not_planned' ? 'wontfix' : 'fixed',
			url: issue.html_url, revision: hash(JSON.stringify(issue)), backend: 'github' as const };
	}
	// Page through managed findings and sort them by severity.
	async list(state: 'open' | 'closed' | 'all' = 'open') {
		const found: NonNullable<ReturnType<GithubReviews['data']>>[] = [];
		for (let page = 1; page <= 100; page++) {
			const issues = z.array(issueSchema).parse(await this.request('?state=' + state + '&per_page=100&page=' + page));
			for (const issue of issues) { const item = this.data(issue); if (item) found.push(item); }
			if (issues.length < 100) return found.sort((a, b) => ['critical','high','medium','low'].indexOf(a.severity) - ['critical','high','medium','low'].indexOf(b.severity));
		}
		throw new Error('GitHub review listing exceeds 100 pages; narrow the repository backlog before retrying');
	}
	// Extract an issue number belonging to the configured repository.
	private number(id: string): string {
		const prefix = 'github:' + this.repository + '#';
		const number = id.startsWith(prefix) ? id.slice(prefix.length) : id.replace(/^#/, '');
		if (!/^[1-9][0-9]*$/.test(number)) throw new Error('Issue must belong to the configured repository');
		return number;
	}
	// Read a managed GitHub finding by its issue identity.
	async get(id: string) {
		const item = this.data(issueSchema.parse(await this.request('/' + this.number(id))));
		if (!item) throw new Error('Issue is not an agent-mcp review finding');
		return item;
	}
	// Serialize GitHub writes and enforce the explicit write gate.
	private async locked<T>(work: () => Promise<T>): Promise<T> {
		if (!this.config.writesEnabled) throw new Error('GitHub review writes are disabled; configure writesEnabled explicitly');
		const lock = this.store.safePath('runtime', 'github-review.lock');
		const descriptor = fs.openSync(lock, 'wx', 0o600);
		try { return await work(); } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
	}
	// Encode a finding inside the reserved GitHub review markers.
	private block(input: Pick<z.infer<typeof reviewInput>, 'key' | 'content' | 'severity' | 'applies_to'>): string {
		if (input.content.includes('<!-- agent-mcp-')) throw new Error('Finding content contains a reserved marker');
		const encoded = Buffer.from(JSON.stringify({ key: input.key, severity: input.severity, applies_to: input.applies_to })).toString('base64url');
		return start + '\n<!-- agent-mcp-meta:' + encoded + ' -->\nSeverity: ' + input.severity + '\n\n' + input.content + '\n' + end;
	}
	// Create a finding or return the issue already associated with its retry key.
	async create(input: z.infer<typeof reviewInput>) {
		input = reviewInput.parse(input);
		return this.locked(async () => {
			const file = this.store.safePath('runtime', 'github-review-keys-' + hash(this.repository) + '.json');
			const keys: Record<string, string> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
			if (Object.prototype.hasOwnProperty.call(keys, input.key)) {
				const existing = await this.get(keys[input.key]!);
				if (existing.key !== input.key) throw new Error('Stored review retry key does not match its GitHub issue');
				return { ...existing, created: false };
			}
			const existing = (await this.list('all')).find((item) => item.key === input.key);
			if (existing) return { ...existing, created: false };
			const item = this.data(issueSchema.parse(await this.request('', 'POST', { title: input.title, body: this.block(input) })));
			if (!item) throw new Error('GitHub returned an invalid review finding');
			Object.defineProperty(keys, input.key, { value: item.id, enumerable: true, configurable: true, writable: true });
			fs.writeFileSync(file + '.tmp', JSON.stringify(keys), { mode: 0o600 });
			fs.renameSync(file + '.tmp', file);
			return { ...item, created: true };
		});
	}
	// Revise the managed finding while preserving unrelated issue content.
	async update(id: string, revision: string, changes: { title?: string; content?: string; severity?: z.infer<typeof severitySchema>; applies_to?: string[] }) {
		return this.locked(async () => {
			const current = await this.get(id);
			if (current.revision !== revision) throw new Error('GitHub finding changed; read it again before updating');
			const managed = current.content.slice(current.content.indexOf(start), current.content.indexOf(end));
			const block = this.block({ ...current, ...changes, content: changes.content ?? managed.slice(managed.indexOf('\n\n') + 2).trim() });
			const body = current.content.slice(0, current.content.indexOf(start)) + block + current.content.slice(current.content.indexOf(end) + end.length);
			const issue = issueSchema.parse(await this.request('/' + this.number(id), 'PATCH', { title: changes.title ?? current.title, body }));
			return this.data(issue);
		});
	}
	// Close a current finding with its resolution reason.
	async resolve(id: string, revision: string, state: 'fixed' | 'wontfix', reason: string) {
		return this.locked(async () => {
			const current = await this.get(id);
			if (current.revision !== revision) throw new Error('GitHub finding changed; read it again before closing');
			const issue = issueSchema.parse(await this.request('/' + this.number(id), 'PATCH', {
				state: 'closed', state_reason: state === 'fixed' ? 'completed' : 'not_planned', body: current.content + '\n\nResolution: ' + reason
			}));
			return this.data(issue);
		});
	}
}

// Load the optional GitHub review backend for the active profile.
export function githubReviews(store: BrainStore): GithubReviews | null {
	const file = store.safePath(store.profile ?? 'default', 'review.jsonc');
	if (!fs.existsSync(file)) return null;
	const errors: ParseError[] = [];
	const config = configSchema.parse(parseJsonc(store.read(file), errors));
	if (errors.length) throw new Error('Invalid review.jsonc');
	const project = listBrainProjects(store.configRoot).find((item) => item.profile === store.profile);
	const repository = config.repository ?? (project?.repository?.url ? githubRepository(project.repository.url) : null);
	if (!repository) throw new Error('GitHub reviews need an explicit repository or a registered GitHub remote');
	return new GithubReviews(store, config, repository);
}
