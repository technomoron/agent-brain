"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localRepositoryCatalog = localRepositoryCatalog;
exports.remoteRepositoryCatalog = remoteRepositoryCatalog;
exports.registerRepositoryTools = registerRepositoryTools;
exports.createRepositoryDiscoveryServer = createRepositoryDiscoveryServer;
const path = require("node:path");
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const version_1 = require("../version");
const config_1 = require("./config");
const remote_policy_1 = require("./remote-policy");
const repositories_1 = require("./repositories");
function localRepositoryCatalog(configRoot) {
    return (0, config_1.listBrainProjects)(configRoot).map((project) => ({
        id: (project.repository?.url ? (0, repositories_1.githubRepository)(project.repository.url) : null) ?? project.name,
        name: project.display_name ?? project.name, group: project.pool,
        permissions: ['read', 'write', 'review'], configuration: 'project'
    }));
}
/** Scan server-side profiles, but expose only registered repositories allowed by all three grants. */
function remoteRepositoryCatalog(config, subject, clientId, scopes) {
    const projects = new Map();
    return config.repositories.flatMap((repo) => {
        const permissions = (0, remote_policy_1.repositoryPermissions)(config, subject, clientId, scopes, repo.id);
        if (!permissions.has('read'))
            return [];
        let entries = projects.get(repo.configRoot);
        try {
            if (!entries) {
                entries = (0, config_1.listBrainProjects)(repo.configRoot);
                projects.set(repo.configRoot, entries);
            }
            const registration = (0, config_1.registeredBrainProject)(repo.configRoot, repo.cwd);
            const project = entries.find((entry) => entry.profile === registration?.profile);
            if ((repo.group && project?.name !== repo.id) || (config.dataRoot && project?.pool !== repo.group))
                return [];
            if (project && !project.roots.some((root) => path.resolve(root) === path.resolve(registration.root)))
                return [];
            return [{ id: repo.id, name: project?.display_name ?? repo.id, group: repo.group,
                    permissions: [...permissions].sort(), configuration: project ? 'project' : 'default' }];
        }
        catch {
            throw new Error('Cannot read the configured repository catalog; ask the server administrator to check its project files');
        }
    }).sort((a, b) => a.id.localeCompare(b.id));
}
function registerRepositoryTools(server, catalog, allow = () => true) {
    for (const name of ['list_repositories', 'list_repository_groups']) {
        if (!allow(name))
            continue;
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
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            catch (error) {
                return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Repository discovery failed' }] };
            }
        });
    }
}
function createRepositoryDiscoveryServer(catalog) {
    const server = new mcp_js_1.McpServer({ name: 'agent-brain', version: (0, version_1.packageVersion)() });
    registerRepositoryTools(server, catalog);
    return server;
}
