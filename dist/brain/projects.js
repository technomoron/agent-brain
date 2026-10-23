"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeBrain = initializeBrain;
exports.inspectProject = inspectProject;
exports.createBrainProject = createBrainProject;
const fs = require("node:fs");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:readline/promises");
const yaml_1 = require("yaml");
const config_tree_1 = require("@technomoron/agent-run/dist/config-tree");
const manifest_1 = require("@technomoron/agent-run/dist/manifest");
const project_1 = require("@technomoron/agent-run/dist/project");
const utils_1 = require("@technomoron/agent-run/dist/utils");
const config_1 = require("./config");
const store_1 = require("./store");
// Initialize external Brain storage, templates and profile directories.
function initializeBrain(configRoot, cwd) {
    if ((0, utils_1.isSamePathOrDescendant)(path.resolve(configRoot), (0, project_1.findProjectRoot)(cwd)))
        throw new Error('Brain configuration must live outside the source repository.');
    (0, config_tree_1.ensureConfigRootLayout)(configRoot);
    const file = path.join(configRoot, 'brain.jsonc');
    if (!fs.existsSync(file))
        fs.writeFileSync(file, '{\n  "enabled": true,\n  "contextBudget": 16000\n}\n', { mode: 0o600, flag: 'wx' });
    (0, config_tree_1.ensureDefaultGlobalTemplates)(configRoot);
    (0, config_tree_1.ensureConfigRootGitignore)(configRoot);
    (0, manifest_1.ensureRootDefaultsFile)(configRoot);
    (0, manifest_1.createProfileMarker)(path.join(configRoot, 'default'));
    for (const project of (0, config_1.listBrainProjects)(configRoot))
        (0, manifest_1.createProfileMarker)(path.join(configRoot, project.profile));
    const store = new store_1.BrainStore(configRoot, cwd);
    try {
        store.writeLocked(() => {
            const directories = new Set([
                store.safePath('global'), store.safePath('default'),
                ...(0, config_1.listBrainProjects)(configRoot).map((project) => store.safePath(project.profile)),
                ...(0, config_1.listBrainProjects)(configRoot).flatMap((project) => project.pool ? [store.safePath('pools', project.pool)] : []),
                ...store.scopes.map((scope) => scope.directory)
            ]);
            for (const directory of directories)
                initializeScopeDirectories(store, directory);
        });
    }
    finally {
        store.close();
    }
}
// Create the knowledge, skill, task and template directories for a scope.
function initializeScopeDirectories(store, directory) {
    for (const folder of [...Object.values(store_1.knowledgeDirectories), 'skills', 'todo', 'templates']) {
        store.directory(directory, folder);
    }
}
// Detect source languages, package scripts and the Git origin.
function inspectProject(cwd) {
    const root = (0, project_1.findProjectRoot)(cwd);
    const git = (0, node_child_process_1.spawnSync)('git', ['-C', root, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', shell: false });
    const languages = [['package.json', 'JavaScript/TypeScript'], ['pyproject.toml', 'Python'], ['go.mod', 'Go'], ['Cargo.toml', 'Rust']]
        .filter(([file]) => fs.existsSync(path.join(root, file))).map(([, language]) => language);
    let scripts = {};
    const pkg = path.join(root, 'package.json');
    if (fs.existsSync(pkg))
        scripts = JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts ?? {};
    return { root, repository: git.status === 0 ? git.stdout.trim() : undefined, languages,
        packageManager: fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(pkg) ? 'npm' : undefined,
        documents: ['README.md', 'AGENTS.md', 'CLAUDE.md'].filter((file) => fs.existsSync(path.join(root, file))), scripts };
}
// Register a source project using detected or interactively supplied settings.
async function createBrainProject(configRoot, cwd, name, mode) {
    config_1.projectConfigSchema.shape.name.parse(name);
    const detected = inspectProject(cwd);
    let root = String(detected.root);
    let description = '';
    let displayName = name;
    let agent = 'codex';
    let conventions = '';
    let constraints = '';
    let architecture = '';
    if (mode !== 'quick') {
        if (!process.stdin.isTTY)
            throw new Error('Interactive project creation requires a terminal; use --quick for detected defaults.');
        process.stdout.write(`${JSON.stringify(detected, null, 2)}\n`);
        const prompt = (0, promises_1.createInterface)({ input: process.stdin, output: process.stdout });
        try {
            root = path.resolve((await prompt.question(`Source root [${root}]: `)).trim() || root);
            description = (await prompt.question('Description (optional): ')).trim();
            if (mode === 'guided') {
                displayName = (await prompt.question(`Display name [${name}]: `)).trim() || name;
                agent = (await prompt.question('Default agent [codex]: ')).trim() || 'codex';
                architecture = (await prompt.question('Architecture summary (optional): ')).trim();
                constraints = (await prompt.question('Constraints (optional): ')).trim();
                conventions = (await prompt.question('Conventions and review rules (optional): ')).trim();
            }
            if (/^n/i.test((await prompt.question('Create project with these values? [Y/n]: ')).trim()))
                return;
        }
        finally {
            prompt.close();
        }
    }
    if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory())
        throw new Error(`Source root does not exist: ${root}`);
    const config = config_1.projectConfigSchema.parse({ name, display_name: displayName, roots: [root], description,
        ...(detected.repository && root === detected.root ? { repository: { url: detected.repository } } : {}), agent: { default: agent } });
    if ((0, config_1.listBrainProjects)(configRoot).some((project) => project.name === name || project.roots.some((existing) => path.resolve(existing) === root)))
        throw new Error('A project with this name or source root already exists.');
    const directory = path.join(configRoot, 'projects', name);
    if (fs.existsSync(directory))
        throw new Error(`Project directory already exists: ${directory}`);
    initializeBrain(configRoot, cwd);
    const store = new store_1.BrainStore(configRoot, cwd);
    try {
        store.writeLocked(() => {
            initializeScopeDirectories(store, directory);
            (0, manifest_1.createProfileMarker)(directory);
            store.atomicWrite(path.join(directory, 'config.yaml'), (0, yaml_1.stringify)(config));
            store.atomicWrite(path.join(directory, 'project.md'), `# ${displayName}\n\n${description}\n`);
        });
    }
    finally {
        store.close();
    }
    const projectStore = new store_1.BrainStore(configRoot, root);
    try {
        for (const [type, title, content] of [['observation', 'Architecture summary', architecture], ['constraint', 'Project constraints', constraints], ['convention', 'Conventions and review rules', conventions]]) {
            if (content)
                projectStore.remember({ scope: 'project', type, title, content, authority: 'user' });
        }
    }
    finally {
        projectStore.close();
    }
    process.stdout.write(`Created ${name} at ${directory}\n`);
}
