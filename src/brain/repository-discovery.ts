import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { packageVersion } from '../version';
import { listBrainProjects, registeredBrainProject } from './config';
import { repositoryPermissions, type Permission, type RemoteConfig } from './remote-policy';
import { githubRepository } from './repositories';

export interface RepositorySummary {
	id: string;
	name: string;
	group?: string;
	permissions: Permission[];
	configuration: 'project' | 'default';
}
export type RepositoryCatalog = () => RepositorySummary[];

export function localRepositoryCatalog(configRoot: string): RepositorySummary[] {
	return listBrainProjects(configRoot).map((project) => ({
		id: (project.repository?.url ? githubRepository(project.repository.url) : null) ?? project.name,
		name: project.display_name ?? project.name, group: project.pool,
		permissions: ['read', 'write', 'review'] as Permission[], configuration: 'project' as const
	}));
}

/** Scan server-side profiles, but expose only registered repositories allowed by all three grants. */
export function remoteRepositoryCatalog(config: RemoteConfig, subject: string, clientId: string, scopes: string[]): RepositorySummary[] {
	const projects = new Map<string, ReturnType<typeof listBrainProjects>>();
	return config.repositories.flatMap((repo) => {
		const permissions = repositoryPermissions(config, subject, clientId, scopes, repo.id);
		if (!permissions.has('read')) return [];
		let entries = projects.get(repo.configRoot);
		try {
			if (!entries) { entries = listBrainProjects(repo.configRoot); projects.set(repo.configRoot, entries); }
			const registration = registeredBrainProject(repo.configRoot, repo.cwd);
			const project = entries.find((entry) => entry.profile === registration?.profile);
			if ((repo.group && project?.name !== repo.id) || (config.dataRoot && project?.pool !== repo.group)) return [];
			if (project && !project.roots.some((root) => path.resolve(root) === path.resolve(registration!.root))) return [];
			return [{ id: repo.id, name: project?.display_name ?? repo.id, group: repo.group,
				permissions: [...permissions].sort() as Permission[], configuration: project ? 'project' as const : 'default' as const }];
		} catch { throw new Error('Cannot read the configured repository catalog; ask the server administrator to check its project files'); }
	}).sort((a, b) => a.id.localeCompare(b.id));
}

export function registerRepositoryTools(server: McpServer, catalog: RepositoryCatalog, allow: (name: string) => boolean = () => true): void {
	for (const name of ['list_repositories', 'list_repository_groups'] as const) {
		if (!allow(name)) continue;
		server.registerTool(name, {
			description: name === 'list_repositories'
				? 'List configured repositories accessible to this authenticated identity and token, with effective permissions. No filesystem paths or Git credentials are returned.'
				: 'List repository groups containing repositories accessible to this identity and token. Hidden members and empty groups are omitted.',
			inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
		}, async () => {
			try {
				const repositories = catalog();
				const result = name === 'list_repositories' ? { repositories } : {
					groups: [...new Set(repositories.flatMap((repo) => repo.group ? [repo.group] : []))].sort().map((id) => ({
						id, repositories: repositories.filter((repo) => repo.group === id)
					}))
				};
				return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
			} catch (error) {
				return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Repository discovery failed' }] };
			}
		});
	}
}

export function createRepositoryDiscoveryServer(catalog: RepositoryCatalog): McpServer {
	const server = new McpServer({ name: 'agent-brain', version: packageVersion() });
	registerRepositoryTools(server, catalog);
	return server;
}
