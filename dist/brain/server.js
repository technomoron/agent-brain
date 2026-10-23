"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSocketPath = void 0;
exports.createBrainServer = createBrainServer;
exports.serveApiCore = serveApiCore;
exports.proxyStdio = proxyStdio;
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const apicore_server_1 = require("@technomoron/apicore-server");
const zod_1 = require("zod");
const version_1 = require("../version");
const store_1 = require("./store");
const consolidation_1 = require("./consolidation");
const skills_1 = require("./skills");
const todos_1 = require("./todos");
const connectors_1 = require("./connectors");
const git_1 = require("./git");
const github_reviews_1 = require("./github-reviews");
const windows_pipe_1 = require("./windows-pipe");
const repository_discovery_1 = require("./repository-discovery");
var config_1 = require("./config");
Object.defineProperty(exports, "defaultSocketPath", { enumerable: true, get: function () { return config_1.defaultSocketPath; } });
// Register Brain tools with backend selection and scope permissions.
function createBrainServer(store, options = {}) {
    const github = (0, github_reviews_1.githubReviews)(store);
    if (github && options.repository && github.repository !== options.repository)
        throw new Error('Review backend repository does not match the authenticated repository');
    const server = new mcp_js_1.McpServer({ name: 'agent-brain', version: (0, version_1.packageVersion)() });
    (0, repository_discovery_1.registerRepositoryTools)(server, options.repositories ?? (() => (0, repository_discovery_1.localRepositoryCatalog)(store.configRoot)), options.allowTool);
    // Register a validated tool with permission checks and broken-file diagnostics.
    function tool(name, description, shape, readOnly, handler) {
        if (options.allowTool && !options.allowTool(name))
            return;
        const schema = zod_1.z.object(shape).strict();
        server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } }, async (input) => {
            store.knowledgeErrors.length = 0;
            store.todoErrors.length = 0;
            try {
                if (!readOnly && options.allowScopeWrite) {
                    const data = input;
                    const scopes = [data.scope, ...((['amend_knowledge', 'promote', 'deprecate_knowledge'].includes(name) || (!github && ['resolve_review', 'review_update'].includes(name))) && data.id ? [store.get(data.id).scope] : [])].filter(Boolean);
                    if (scopes.some((scope) => !options.allowScopeWrite(scope)))
                        throw new Error('Write access to the entire target scope is required');
                }
                if (!readOnly && options.allowTool && !options.allowTool('review_update')) {
                    const data = input;
                    if (data.type === 'review' || (data.id && ['amend_knowledge', 'promote', 'deprecate_knowledge'].includes(name) && store.get(data.id).type === 'review')) {
                        throw new Error('Review permission is required to change findings');
                    }
                }
                const result = await handler(zod_1.z.object(shape).strict().parse(input));
                return { content: [{ type: 'text', text: JSON.stringify(store.withDiagnostics(result)) }] };
            }
            catch (error) {
                return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
            }
        });
    }
    const id = zod_1.z.string().min(1).max(200);
    const revision = zod_1.z.string().regex(/^[a-f0-9]{64}$/);
    tool('brain_status', 'Show the active project and available scopes. Global is server-wide; pool is shared only by members of the active pool.', {}, true, () => ({ profile: store.profile, pool: store.pool, scopes: store.scopes.map((entry) => entry.scope), reviewBackend: github ? 'github' : 'internal', repository: github?.repository ?? options.repository, group: options.group }));
    tool('sync_status', 'Preview Git state and the canonical files eligible for saving. Runtime files, indexes, credentials, and native agent state are excluded.', {}, true, () => (0, git_1.gitPreview)(store));
    for (const name of ['brain_sync', 'brain_flush', 'sync', 'flush']) {
        if (options.allowTool && !options.allowTool(name))
            continue;
        server.registerTool(name, { description: 'When the user explicitly asks "brain sync" or "brain flush", commit and push canonical Brain changes to its configuration repository. Messages are generated. Report errors and unsynced changes to the user. This does not commit project source code.',
            inputSchema: { action: zod_1.z.enum(['init', 'save', 'pull', 'push', 'sync']).default('sync'), confirmed: zod_1.z.literal(true).optional(), message: zod_1.z.string().min(1).max(1000).optional() },
            annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
        }, async ({ action, message }) => {
            try {
                if (options.sync && !['save', 'sync'].includes(action))
                    throw new Error('Remote Brain supports sync/save/flush only.');
                const result = options.sync ? await options.sync(message) : (0, git_1.syncGit)(store, action, message);
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            catch (error) {
                return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
            }
        });
    }
    tool('get_context', 'Retrieve relevant constraints and knowledge before substantial work. Check omitted; explicitly fetch required knowledge if the budget excluded it.', {
        task: zod_1.z.string().max(10000), files: zod_1.z.array(zod_1.z.string()).max(100).optional(), symbols: zod_1.z.array(zod_1.z.string()).max(100).optional()
    }, false, ({ task, files, symbols }) => store.context(task, files, symbols));
    tool('search_knowledge', 'Search Markdown knowledge in the active scopes using SQLite FTS.', {
        query: zod_1.z.string().max(10000), scopes: zod_1.z.array(store_1.scopeSchema).optional(), types: zod_1.z.array(store_1.typeSchema).optional(),
        includeDeprecated: zod_1.z.boolean().optional(), limit: zod_1.z.number().int().min(1).max(100).optional()
    }, false, ({ query, ...options }) => store.search(query, options));
    tool('list_knowledge', 'Inventory knowledge metadata with scope/type filters and pagination. Includes the context budget; read full records before consolidation.', consolidation_1.inventoryOptions.shape, true, (input) => (0, consolidation_1.listKnowledge)(store, input));
    tool('knowledge_history', 'Look up archived knowledge and replacement IDs. Pass an old id to retrieve its exact original file text. Excluded from normal retrieval.', consolidation_1.historyOptions.shape, true, (input) => (0, consolidation_1.knowledgeHistory)(store, input));
    tool('archive_knowledge', 'After authorized consolidation and verified coverage, archive exact source files and replacement references before removing the files. Same scope and authority only; revisions are required for sources and replacements. Identical retries finish interrupted deletion.', consolidation_1.archiveInput.shape, false, (input) => (0, consolidation_1.archiveKnowledge)(store, input));
    tool('get_knowledge', 'Read a complete knowledge item and its current revision.', { id }, true, ({ id }) => store.get(id));
    tool('remember', 'Persist durable knowledge when authorized by the user. Choose scope and a singular type; the server stores it in the matching directory (for example constraint in constraints/, preference in preferences/). Explicit user instructions have authority=user; deductions remain inferred observations. Global writes require explicit global intent. Use todo tools for tasks; skills and templates are separate files.', store_1.knowledgeInput.shape, false, (input) => { if (github && input.type === 'review')
        throw new Error('Use review_create for the configured GitHub review backend'); return store.remember(input); });
    tool('amend_knowledge', 'Revise an active item in place using its last-read revision, keeping its id, file name, scope, type, authority, and history. Use this to correct or extend existing knowledge instead of writing a near-duplicate. Scope, type, authority, and review severity cannot be changed this way.', {
        id, revision, changes: store_1.knowledgeChanges
    }, false, ({ id, revision, changes }) => store.amend(id, revision, changes));
    tool('promote', 'Copy active knowledge to another available scope with user authority. Requires explicit user approval; the original is preserved.', {
        id, scope: store_1.scopeSchema, revision, confirmed: zod_1.z.literal(true)
    }, false, ({ id, scope, revision }) => store.promote(id, scope, revision));
    tool('deprecate_knowledge', 'Deprecate outdated knowledge without deleting its history.', { id, revision, reason: zod_1.z.string().max(2000).optional() }, false, ({ id, revision, reason }) => store.deprecate(id, revision, reason));
    tool('list_skills', 'List available skills and descriptions. Local skills override global skills with the same name.', {}, true, () => (0, skills_1.listSkills)(store));
    tool('get_skill', 'Load a full skill only when it applies to the current task.', { name: zod_1.z.string().max(100) }, true, ({ name }) => (0, skills_1.getSkill)(store, name));
    tool('review_context', 'Retrieve constraints, decisions, prior review findings, and path-specific knowledge for a code review.', {
        task: zod_1.z.string().max(10000), files: zod_1.z.array(zod_1.z.string()).max(100).optional()
    }, false, ({ task, files }) => store.context(`review constraint decision ${task}`, files));
    tool('review_get', 'Read a finding from the configured internal or per-repository GitHub backend.', { id }, true, ({ id }) => github ? github.get(id) : store.get(id));
    tool('review_create', 'Record an authorized review finding in the configured backend. GitHub requires enabled writes and explicit confirmation; key deduplicates retries.', github_reviews_1.reviewInput.shape, false, (input) => github ? github.create(input) : store.remember({ scope: store.profile ? 'project' : 'default', type: 'review', authority: 'inferred', title: input.title, content: input.content, severity: input.severity, applies_to: input.applies_to }));
    tool('review_update', 'Revise a finding using its last-read revision. GitHub preserves text outside its managed block.', {
        id, revision, confirmed: zod_1.z.literal(true), changes: zod_1.z.object({ title: zod_1.z.string().min(1).max(250).optional(), content: zod_1.z.string().min(1).max(40000).optional(), severity: store_1.severitySchema.optional(), applies_to: zod_1.z.array(zod_1.z.string().max(500)).max(100).optional() }).strict()
    }, false, ({ id, revision, changes }) => {
        if (github)
            return github.update(id, revision, changes);
        if (changes.severity)
            throw new Error('Internal finding severity changes require the existing review workflow');
        return store.amend(id, revision, changes);
    });
    tool('review_list', 'List open findings from the configured backend. GitHub issues belong to this repository; PRs are excluded.', {
        severity: zod_1.z.array(store_1.severitySchema).optional(), state: zod_1.z.array(store_1.reviewStateSchema).optional()
    }, true, async ({ severity, state }) => {
        if (github)
            return (await github.list(state ? 'all' : 'open')).filter((item) => (!severity || severity.includes(item.severity)) && (!state || state.includes(item.state)));
        return store.reviews({ severity, state }).map((item) => ({ finding: item.finding, severity: item.severity, state: item.state ?? 'open', title: item.title, applies_to: item.applies_to, id: item.id, revision: item.revision }));
    });
    tool('review_history', 'Recall closed findings from the configured backend, with pagination.', {
        scope: store_1.scopeSchema.optional(), query: zod_1.z.string().max(1000).optional(), state: zod_1.z.enum(['fixed', 'wontfix']).optional(),
        offset: zod_1.z.number().int().min(0).optional(), limit: zod_1.z.number().int().min(1).max(1000).optional()
    }, true, async (options) => {
        if (!github)
            return store.reviewHistory(options);
        const items = (await github.list('closed')).filter((item) => (!options.state || item.state === options.state) && (!options.query || JSON.stringify(item).toLowerCase().includes(options.query.toLowerCase())));
        return { total: items.length, items: items.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50)) };
    });
    tool('review_archive', 'Compact internal closed finding files. GitHub retains its own issue history.', { scope: store_1.scopeSchema }, false, ({ scope }) => { if (github)
        throw new Error('GitHub owns review history; no internal archive is needed'); return store.archiveReviews(scope); });
    tool('resolve_review', 'Close an authorized fix or explicitly dropped finding in the configured backend. GitHub writes must be enabled. Deferred findings stay open.', {
        id, revision, state: zod_1.z.enum(['fixed', 'wontfix']), reason: zod_1.z.string().min(1).max(2000).optional()
    }, false, ({ id, revision, state, reason }) => github ? github.resolve(id, revision, state, reason ?? state) : store.resolveReview(id, revision, state, reason));
    tool('todo_list', 'List structured tasks in the active scopes.', { status: todos_1.todoInput.shape.status.optional() }, true, ({ status }) => (0, todos_1.listTodos)(store).filter((item) => !status || item.status === status));
    tool('todo_get', 'Read a task and its revision.', { id }, true, ({ id }) => (0, todos_1.getTodo)(store, id));
    tool('todo_add', 'Create a local task. Reimporting the same external task returns the existing task.', todos_1.todoInput.shape, false, (input) => (0, todos_1.addTodo)(store, input));
    tool('todo_update', 'Update a local task using its last-read revision. Does not change remote tasks.', { id, revision, changes: todos_1.todoChanges }, false, ({ id, revision, changes }) => (0, todos_1.updateTodo)(store, id, revision, changes));
    tool('todo_complete', 'Mark a local task done. Does not change remote tasks.', { id, revision }, false, ({ id, revision }) => (0, todos_1.updateTodo)(store, id, revision, { status: 'done' }));
    for (const name of ['todo_import', 'todo_sync']) {
        if (options.allowTool && !options.allowTool(name))
            continue;
        server.registerTool(name, { description: 'Import tasks from a configured connector. Merge remote changes only when they do not conflict with local edits; report conflicting task IDs. Remote tasks are never modified.',
            inputSchema: { source: zod_1.z.string().max(100), scope: store_1.scopeSchema }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
        }, async ({ source, scope }) => {
            try {
                return { content: [{ type: 'text', text: JSON.stringify(await (0, connectors_1.syncConnector)(store, source, scope)) }] };
            }
            catch (error) {
                return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
            }
        });
    }
    return server;
}
// Require a private socket directory owned by the current user.
function requirePrivateSocketDirectory(socketPath) {
    const stat = fs.lstatSync(path.dirname(socketPath));
    if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
        throw new Error(`The socket directory ${path.dirname(socketPath)} must be owned by the current user with mode 0700 (current uid ${process.getuid()}, owner uid ${stat.uid}, mode ${(stat.mode & 0o777).toString(8)}). Run agent-run and agent-brain as the same user.`);
}
// Serve local MCP requests through a private socket or Windows pipe.
async function serveApiCore(configRoot, socketPath) {
    if (process.platform !== 'win32') {
        const directory = path.dirname(socketPath);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        requirePrivateSocketDirectory(socketPath);
        if (fs.existsSync(socketPath))
            throw new Error(`Socket already exists: ${socketPath}. Stop the running service, or remove the socket after confirming it is stale.`);
    }
    else if (!/^\\\\\.\\pipe\\[a-zA-Z0-9._-]+$/.test(socketPath)) {
        throw new Error('On Windows, --socket must be a local named pipe (\\\\.\\pipe\\name).');
    }
    let ready = false;
    const api = new apicore_server_1.ApiServer({ authApi: false, origins: [], devMode: false });
    api.fastify.post('/mcp', async (request, reply) => {
        if (!ready)
            return reply.code(503).send();
        if (request.headers.origin)
            return reply.code(403).send({ error: 'Browser requests are not supported' });
        if (request.headers['x-agent-brain-root'] !== encodeURIComponent(path.resolve(configRoot)))
            return reply.code(409).send({ error: 'This service uses a different configuration directory' });
        const cwdHeader = request.headers['x-agent-brain-cwd'];
        if (typeof cwdHeader !== 'string')
            return reply.code(400).send({ error: 'Missing project directory' });
        let cwd;
        try {
            cwd = decodeURIComponent(cwdHeader);
        }
        catch {
            return reply.code(400).send({ error: 'Invalid project directory' });
        }
        if (!path.isAbsolute(cwd) || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory())
            return reply.code(400).send({ error: 'Invalid project directory' });
        const store = new store_1.BrainStore(configRoot, cwd);
        const server = createBrainServer(store);
        const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        reply.hijack();
        try {
            await server.connect(transport);
            await transport.handleRequest(request.raw, reply.raw, request.body);
        }
        finally {
            await server.close();
            store.close();
        }
    });
    api.fastify.route({ method: ['GET', 'DELETE'], url: '/mcp',
        // Reject unsupported HTTP methods on the local MCP endpoint.
        handler: async (_request, reply) => reply.code(405).send() });
    await api.fastify.listen({ path: socketPath });
    try {
        if (process.platform === 'win32')
            await (0, windows_pipe_1.checkWindowsPipe)(socketPath, true);
        else
            fs.chmodSync(socketPath, 0o600);
        ready = true;
    }
    catch (error) {
        await api.fastify.close();
        throw error;
    }
    return {
        // Close the local API listener.
        close: () => api.fastify.close()
    };
}
// Bridge MCP standard input and output to the private local service.
async function proxyStdio(socketPath, cwd, configRoot) {
    if (process.platform === 'win32') {
        try {
            await (0, windows_pipe_1.checkWindowsPipe)(socketPath);
        }
        catch (error) {
            throw new Error(`Agent-brain service is not running or its pipe is not private at ${socketPath}. Start agent-brain serve with the same --configdir and --socket. ${String(error)}`);
        }
    }
    else {
        const socket = fs.lstatSync(socketPath, { throwIfNoEntry: false });
        if (!socket)
            throw new Error(`Agent-brain service is not running at ${socketPath}. Start agent-brain serve with the same --configdir and --socket, or enable its systemd user service.`);
        requirePrivateSocketDirectory(socketPath);
        if (!socket.isSocket() || socket.uid !== process.getuid() || (socket.mode & 0o077) !== 0)
            throw new Error('The brain socket must belong to the current user with mode 0600.');
    }
    const stdio = new stdio_js_1.StdioServerTransport();
    let protocolVersion;
    // Forward one MCP message and relay its validated response.
    async function send(message) {
        const response = await new Promise((resolve, reject) => {
            const request = http.request({ socketPath, path: '/mcp', method: 'POST', headers: {
                    'content-type': 'application/json', accept: 'application/json, text/event-stream',
                    'x-agent-brain-cwd': encodeURIComponent(cwd), 'x-agent-brain-root': encodeURIComponent(path.resolve(configRoot)),
                    ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {})
                } }, (response) => {
                const chunks = [];
                let bytes = 0;
                response.on('data', (chunk) => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024)
                    response.destroy(new Error('Brain response exceeds 4 MiB'));
                else
                    chunks.push(chunk); });
                response.on('error', reject);
                response.on('end', () => response.statusCode && response.statusCode >= 200 && response.statusCode < 300
                    ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`Brain service returned HTTP ${response.statusCode}`)));
            });
            request.setTimeout(30000, () => request.destroy(new Error('Brain service request timed out')));
            request.on('error', reject);
            request.end(JSON.stringify(message));
        });
        if (response) {
            const parsed = types_js_1.JSONRPCMessageSchema.parse(JSON.parse(response));
            if ('result' in parsed && typeof parsed.result.protocolVersion === 'string')
                protocolVersion = parsed.result.protocolVersion;
            await stdio.send(parsed);
        }
    }
    // Relay client messages and report forwarding failures through JSON-RPC or stderr.
    stdio.onmessage = (message) => {
        void send(message).catch(async (error) => {
            if ('id' in message && 'method' in message)
                await stdio.send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
            else
                process.stderr.write(`${String(error)}\n`);
        });
    };
    await stdio.start();
}
