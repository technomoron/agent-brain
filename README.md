# agent-brain

Project knowledge, skills, reviews and tasks through MCP. Extracted from agent-run. Requires Node.js 24 or newer.

The package provides the `agent-brain` command, with `agent-mcp` retained as a compatibility alias. Existing `brain.jsonc`, source-root registrations, Markdown storage, MCP server names and per-user sockets remain compatible. No knowledge or profile files are moved by installing this package.

## Installation

```sh
npm install --global @technomoron/agent-brain
```

The npm package is public. The source repository and private skill catalogs keep
their own access controls. Node.js 24 or newer is required.

## Development

Keep the agent-run and agent-brain checkouts next to each other. Build agent-run first, then install this package’s dependencies and link the local agent-run checkout:

```sh
cd ../agent-run
pnpm install
pnpm build
cd ../agent-brain
pnpm install
node scripts/link-agent-run.cjs
pnpm build
```

Run `pnpm test` for the server and agent-run integration suite. The test harness supplies this checkout’s executables through an isolated temporary PATH. Run `npm run build` to check the npm build path.

The server currently depends on `@technomoron/agent-run` for profile resolution, initialization and Nunjucks skill rendering. This preserves existing behavior while moving server ownership into this repository; it does not yet make the server independent of the launcher’s profile format. Link the sibling launcher checkout when developing changes to those libraries; normal installations use the published dependency.

## Running

[examples/brain.jsonc](examples/brain.jsonc) shows the optional configuration
root settings. Save it as brain.jsonc outside the source checkout. The packaged
[local service unit](ops/systemd/agent-brain.service) supports a per-user service.


```sh
agent-brain init --configdir /path/to/agent-config
agent-brain serve --configdir /path/to/agent-config
```

Agents continue to use `agent-brain mcp --configdir ... --cwd ...`. Agent-run’s `mcp`, `create` and `project` commands delegate to `agent-brain` on PATH. Install the server separately before using those commands or knowledge compression.

Operational systemd and Windows installation scripts remain in agent-run, which orchestrates the native agent environment. See agent-run’s README for the storage model, CLI operations, permissions and service installation.

## MCP-owned skills

The server bundles `brain-consolidate`, `brain-import`, `brain-memory`, `code-review`, and `todo-manager` under `skills/`.

`code-review` is served directly by `list_skills` and `get_skill`; no configuration copy is required. Explicit global, pool, or project overrides remain supported. Legacy `brain-review`, `code-review-organizer`, and `review-items` copies are excluded from MCP discovery. Remove these copies from configurations and update their callers to `code-review`.

The review workflow uses ordinary GitHub Issues through GitHub tools or `gh`. Brain supplies project context; GitHub owns issue identity, metadata, discussion and history. Existing `review_*` tools remain a compatibility API for earlier installations, not a requirement of the bundled skill.

Initialization installs missing copies of the other packaged workflows and preserves customizations. Consolidation's CLI fallback reads its packaged source.

## Shared skill catalog

`technomoron/agent-mcp-skills` is the private source catalog for reusable skills. This extraction does not implement Git catalog fetching, refresh schedules, grouped selection or customer-level scopes. Existing skills continue to load from external global and project profile directories.

## Releases

The release workflow publishes `@technomoron/agent-brain` on npm with public
access. Tags use `@technomoron/agent-brain@<version>` and must match the package
version. Run `pnpm release:preflight` before committing and tagging a release.
The workflow checks the tag, runs the integration suite, and attaches the package
tarball to its GitHub release. Configure `NPM_TOKEN` in the source repository for
npm publishing; private source repositories publish without provenance.

## Remote OAuth endpoint

The remote endpoint uses the generic OAuth APIs in
`@technomoron/apicore-server` 1.1.0 or newer. Normal npm installations include
that dependency. When developing changes to apicore locally, build the sibling
`../apicore` checkout and run `node scripts/link-apicore.cjs`; reinstalling
dependencies replaces this development link.

Copy `examples/remote.jsonc` outside the source tree and customize absolute paths.
Create each repository's separate configuration root using `agent-brain init
--configdir <root> --cwd <checkout>`. Run the server as a dedicated OS user with a
private runtime directory (0700). Supply two different random signing secrets of
at least 32 characters through `MCP_OAUTH_ACCESS_SECRET` and
`MCP_OAUTH_REFRESH_SECRET`. Set each human user's `passwordEnv` to a plaintext
password environment variable, or `passwordHashEnv` to a bcrypt hash variable;
choose one. Plaintext passwords are hashed in memory at startup. Keep the
environment file private and restart after password changes.
Optional TOTP secrets are base32 values enrolled
in the user's authenticator. Enrolment and password management are administrator
operations. Service accounts use confidential client secrets from the environment.
Never put credentials in source control or client command arguments.

Start `agent-brain serve-remote --remote-config /private/remote.jsonc`. It binds only
to loopback, or the configured private Unix socket. Nginx terminates HTTPS and can
proxy the issuer, discovery and resource paths to this process:

```nginx
server {
    listen 443 ssl;
    server_name mcp.example.com;
    ssl_certificate /etc/letsencrypt/live/mcp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.example.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_buffering off;
    }
}
```

Use an OAuth-capable MCP HTTP client with the configured client ID and exact
registered redirect URI. Interactive grants require S256 PKCE, password login and
explicit consent; TOTP is checked when configured. Discovery is at
`/.well-known/oauth-authorization-server/oauth` and
`/.well-known/oauth-protected-resource/mcp` for the example URLs. Dynamic client
registration is not supported. Request scopes such as
`read write review repo:technomoron/agent-run`; send `X-Agent-Repository:
technomoron/agent-run` with every MCP POST. Configure a separate client connection
for each repository. Service clients use `client_credentials` with `resource` and
`scope`; they receive an access token and request a new grant after expiry.
The existing local stdio bridge continues to use the private local socket and is
not an OAuth login client.

Every request intersects current user grants, client grants and token scopes.
Patterns are `owner/repo`, `owner/*`, or `*`; only explicitly configured repository
IDs are served. Ungrouped repositories have isolated data roots; declared groups share common
knowledge and keep separate project profiles.
Clients cannot select filesystem paths. `write` permits knowledge/task changes;
`review` permits finding changes. Git synchronization requires write permission; connector imports, archival
and unknown tools are unavailable remotely. Policy edits take effect on the next
request; endpoint/path changes fail closed until restart. Restart after changing
client registrations or secrets. Persistent sessions survive restarts; revoke a
session through the token store, or disable its user/remove access to deny it
immediately. Run one process per runtime directory; browser authorization codes
and unfinished login forms are deliberately lost on restart.

## Reviews as GitHub Issues

Create `<active-profile>/review.jsonc` (or `default/review.jsonc`) inside the
repository's private configuration root:

```json
{"backend":"github","repository":"technomoron/agent-run","tokenEnv":"MCP_GITHUB_TOKEN","writesEnabled":true}
```

The token needs issue access to that private repository. Prefer a narrowly scoped
GitHub App installation token or fine-grained token; token rotation is managed by
the operator. Without `writesEnabled: true`, GitHub writes fail closed. The
`review_*` tools use repository issue IDs and revision checks, preserve discussion
outside their managed block, and deduplicate creation by a stable finding `key`.
Retry keys are persisted locally to handle GitHub's delayed issue listings.
GitHub offers no atomic issue-create idempotency or conditional PATCH here: a
crash between creation and saving the key, or separate MCP instances creating the
same finding simultaneously, can still require manual reconciliation. Re-read
before writes; revision checks cannot eliminate races with concurrent GitHub edits.
Old internal findings are not migrated automatically. This compatibility adapter uses its own managed metadata format; the bundled `code-review` skill instead uses ordinary GitHub issues directly.

The reusable private skill repository is separate from MCP-owned workflows.
Automatic catalog cloning/polling and OAuth login in the local stdio bridge are
not implemented by this change.

## Repository groups

A remote configuration can declare `groups: [{"id":"agent-tools",
"configRoot":"/var/lib/agent-mcp/groups/agent-tools"}]`. Set `group: "agent-tools"`
and that same `configRoot` on each member of `repositories`. Each member keeps
its own repository ID and working directory. Register its project at
`<configRoot>/projects/<owner>/<repo>/config.yaml` with `name: owner/repo` and
`roots: [<working-directory>]`; initialize the Brain root to install profile
markers and built-in skills. The server refuses grouped members without their
own matching project profile.

Members share the root's `global` knowledge and skills. In this context, that
scope means **shared within this group**, not shared across the server. Project
notes, tasks and review configuration remain in each member's project profile.
A grant to any member permits reading common group knowledge; keep material that
must remain repository-private in project scope. Repository and token permission
checks still apply to every request; group membership does not grant access to a
sibling repository. `brain_status` reports the repository and group. Unrelated
repositories and groups must have separate, non-overlapping roots. Restart after
changing group membership or paths.

Git authentication is independent of groups. The service may use its own private
SSH key under its OS user's `.ssh` directory; do not copy keys into project roots
or configuration Git. GitHub account SSH keys inherit that account's repository
access. Deploy keys are repository-specific; GitHub has no organization-wide SSH
key. A GitHub App can instead provide organization-scoped HTTPS/API access.

## Repository discovery

Call `list_repositories` to see repositories available to the current identity,
with display names, group IDs and effective read/write/review permissions.
`list_repository_groups` returns only groups with visible member repositories.
The server scans project configuration and intersects it with the explicit served
repository registry, current user grants, client grants and token scopes. It does
not enumerate everything the server's GitHub SSH identity can access. Unregistered
projects, hidden members, empty groups, credentials and internal paths are omitted.
Changes to access rules apply to subsequent requests.

An authenticated client can call these tools at `/mcp` without
`X-Agent-Repository`. Only the discovery tools are available until a repository
is selected. Send `X-Agent-Repository: owner/repo` for knowledge, skill, task and
review tools. Discovery remains available after selection. Request a token with
`read` and the desired repository scopes, such as `repo:*`; a token narrowed to
one repository will only discover that repository, even if the user can access
others. Local stdio clients can also use these tools to list their local project
catalog; local access follows the existing OS-user trust model.

### Global knowledge and repository pools

Use one configuration root with three parallel directories:

```text
global/                        # knowledge and skills shared by all repositories
pools/acme/                    # knowledge and skills shared by this pool
projects/acme/catalog-api/     # repository knowledge, reviews and tasks
```

Set `pool: acme` in each member's `projects/<owner>/<repo>/config.yaml`.
The MCP reads only global, the active repository's pool, and that repository.
Skills with the same name resolve in repository, pool, global order. A skill can
extend an ancestor with `extends: global:name` or `extends: pool:name`.
Knowledge keeps its scope and authority; a more specific inferred observation
does not replace an explicit user constraint.

For a remote server, set `dataRoot` to this shared configuration root and use
that same `configRoot` for its groups and repositories. The existing `group`
registration identifies the pool and must match the project's `pool` field.
For independent repositories, omit `pool` from both the project and deployment
manifest, and omit `group` from the remote registration. They receive global
and project context without sharing a pool.
Legacy separate group roots remain supported when `dataRoot` is absent.
Global writes require a wildcard token and current wildcard write permission.
Pool writes require write permission for every registered member. Reading a
repository includes its global and pool knowledge. Reviews, their counters and
history, tasks, and GitHub issue targets stay with the individual repository.

### Configuration push deployment

`ops/config-policy.cjs` and `ops/config-deploy.cjs` support the private configuration
repository's push workflow. `.brain-deploy.json` explicitly lists pools and served
repositories; source-machine roots are replaced by server checkout roots. Core
skills remain owned by this package. A three-way comparison preserves independent
MCP writes and rejects conflicting Git edits before changing live data.

The installed forced-command entry accepts only `deploy <full-main-SHA>`. The
root-owned controller runs Git and data operations as `agent-mcp`, stops the
service only after validation, updates repository/group registration without
changing users or client grants, and restarts with health checks and rollback.
The controller uses root-owned packaged deployment code; it never runs the
configuration checkout's validation or deployment scripts on the server.
The existing `agent-mcp` service account and on-disk paths are retained for
compatibility; the application and package are named agent-brain.

### Export Brain changes to Git

Configure `gitSync: {"catalog":"/var/lib/agent-mcp/catalogs/agent-brain-config",
"state":"/var/lib/agent-mcp/config-deploy"}` alongside `dataRoot` in the remote
server configuration. The catalog origin must grant SSH write access, and its
local `user.name` and `user.email` must identify the configured human author.
The deployment state must contain its successful deployment baseline.

The authenticated MCP `brain_sync` and `brain_flush` tools (chat commands `brain sync` and
`brain flush`) default to committing and pushing
canonical changes. The active repository is exported; pools and global data are
added only with full write access to those scopes. Review data additionally
requires review permission. The command never commits project source code.
Git-only edits are preserved; competing edits fail with paths for reconciliation.
Generated metadata, client/server configuration, credentials, runtime files and
bundled core skills are excluded.

Exports and configuration deployments share `state/catalog.lock`. Sync snapshots
canonical data under the Brain write lock, then commits in a private temporary
clone and pushes main without force. Failed exports are retained under
`state/exports`; live data remains intact. Retry after correcting access, network
or conflicts. Successful exports are deleted; unchanged data creates no commit.
A lock left by a killed process requires an operator to verify the process has
stopped before removing it.

Agent-run flushes remote Brain when a wrapped agent exits, including signal exits
when the launcher can finish cleanup. Failures warn on stderr without changing
the agent status. SIGKILL, power loss and a forcibly closed terminal cannot
guarantee cleanup; explicit chat `brain sync` is available throughout a session.

The older MCP tool names `sync` and `flush` remain compatibility aliases.
New clients and instructions use `brain_sync` and `brain_flush`. Bare chat
“sync” or “flush” does not by itself select Brain as the target.

## Local service and knowledge guide

Agent-brain owns canonical knowledge, specifications, skills, reviews, tasks,
connectors, retrieval and configuration synchronization. Its project profile is
`projects/technomoron/agent-brain` under the external configuration root;
agent-run owns launcher configuration, native adapters and the client connection.
Both projects remain members of the `agent-tools` pool. Source registrations and
private runtime credentials remain outside both source repositories.

The local service uses the official Node MCP SDK and apicore-server, with Node's
built-in SQLite and FTS. It uses a private per-user Unix socket or Windows named
pipe. The remote OAuth endpoint is configured separately above.

### Start using it

```sh
agent-brain init
agent-brain serve
```

Keep the service running, or enable the systemd user service described below.
In another terminal:

```sh
cd ~/code/my-project
agent-run create my-project --quick
agent-run codex
```

Omit `--quick` for the short interactive setup, or use `--guided` to add an
architecture summary, constraints, conventions, and a preferred agent.
Creation detects the source root, Git remote, languages, package manager,
documentation, and package scripts. It writes configuration outside the source
repository. Existing directories and duplicate project registrations are rejected.

`agent-run project list` lists registrations. `project info` shows the current
project, and `project bootstrap` returns detected information for the agent to
inspect and turn into proposals. Bootstrap does not invent or save architectural
facts; the agent can use the knowledge tools after the user confirms its proposals.

All commands accept `--configdir PATH`. Brain commands also accept `--cwd PATH`.
`agent-brain --help` lists the commands.

### Scopes and existing profiles

```text
~/.agent-run/
  brain.jsonc
  global/skills/<name>/SKILL.md
  global/constraints/*.md
  projects/my-project/
    agent-run.jsonc
    config.yaml
    project.md
    memory/*.md
    todo/*.md
    live/
  default/
    agent-run.jsonc
    skills/
    preferences/
    constraints/
    conventions/
    reviews/
    memory/*.md
    todo/
    templates/
    live/
  index/knowledge.sqlite
  runtime/
```

Inside a registered or existing configured project, retrieval includes global
and project knowledge. Elsewhere it includes global and default knowledge.
Default knowledge never appears in a configured project. Among registered
source roots, the most specific matching root wins; equal matches are rejected.
An explicit `AGENT_RUN_PROFILE` in `.agent-run.env` keeps precedence over registration.

Project names can include a namespace: `technomoron/agent-run` lives under
`projects/technomoron/agent-run`. The original name also works in
`AGENT_RUN_PROFILE`; no alias is needed.

Existing JSONC manifests, Nunjucks templates, and `org/repo` profiles remain
supported. Brain reads existing `notes/memory` directories in place, including
the config root's global notes. It does not move or delete them. New knowledge
uses the directories above. Existing files without metadata are treated as
inferred, relevant-only knowledge; adding metadata gives you explicit control.
Legacy review metadata is preserved, and reviews marked addressed or resolved
are excluded from active recall. Canonical `global/skills/<name>/SKILL.md` files
also support existing Nunjucks variables when served or rendered for native agents.

`agent-brain init` installs the shared brain skills and a default profile, and
creates `brain.jsonc` only if it does not exist. It preserves existing files.
It creates the topic directories shown above in global, default, and registered
project scopes, plus `rules/`, `decisions/`, `specs/`, and `observations/` for
the other knowledge types. Project creation uses the same layout. Empty topic
directories stay empty until there is relevant content to store.
Normal profile rendering then adds the brain MCP server and shared instructions
to Codex, Claude, Gemini, and Grok. An explicitly configured `agent-brain` MCP
entry takes precedence. Set `enabled` to `false` to stop automatic integration
and restore the previous unconfigured-project behavior.

```jsonc
{
  "enabled": true,
  "contextBudget": 16000,
  "connectors": {}
}
```

`contextBudget` counts serialized characters, not model tokens. A context result
reports omitted items. Use `get_knowledge` to read complete items when necessary.
Always-recalled knowledge is considered first, then matching file patterns,
then lexical results. Search uses FTS ranking with extra weight for titles and tags.
Queries compare the current files with the index and write only added, changed,
or removed entries. Unchanged queries do not take a database write lock. Context
retrieval scans the files once. Search and context MCP tools declare that they
may write because they can refresh this derived index.
Symbols contribute search terms. Manual Markdown changes are read on every query;
the index can be deleted while the service is stopped and rebuilt on the next query.

### Knowledge and skills

Malformed knowledge and task files do not block other entries. When a scan finds
problems, MCP and CLI list/search responses contain `items` and `brokenFiles`;
object responses, including context, gain a `brokenFiles` field. Each error lists
the source path, `status: "broken"`, a reason, and an ID when it can be parsed.
Responses without errors keep their existing format. Broken entries are excluded
from search and context, and reads or updates of those entries are refused.
Correct the file on disk; the next scan picks up the repair automatically.
Duplicate IDs flag all matching files. External task imports and new review
numbering stop when broken files would make deduplication or numbering unreliable.

Knowledge is one Markdown file per item, with YAML metadata:

```markdown
---
id: auth-refresh-single-use
type: constraint
scope: project
authority: user
status: active
recall: always
tags: [auth]
applies_to: ["src/auth/**"]
created: 2026-09-06
---

# Refresh tokens are single-use

A successfully consumed refresh token must never be accepted again.
```

The storage directories are `rules`, `preferences`, `conventions`, `constraints`,
`decisions`, `specs`, `reviews`, `memory`, and `observations`. Scope metadata must
match the file's directory. IDs must be unique across the active scopes.
Invalid metadata produces an error identifying the file. Symlinked storage
paths are rejected. Individual Markdown files are limited to 1 MiB.

Choose the scope and singular knowledge type when calling `remember`; MCP writes
the file into the corresponding directory. User preferences belong in
`preferences/`, requirements in `constraints/`, established practices in
`conventions/`, confirmed specifications in `specs/`, and confirmed choices in
`decisions/`. Code-derived facts remain inferred `observations/`; source
references and history belong in `memory/`, with planned features labeled as
plans. An import request does not make inferred content authoritative.
Use the todo tools for tasks. Reusable workflows are `skills/<name>/SKILL.md`
files, and reusable templates belong in `templates/`; `remember` does not
install either. Global skills remain available without copying them into each
project. The brain-memory skill explains these choices to native agents.

Available MCP tools include `get_context`, `search_knowledge`, `get_knowledge`,
`remember`, `amend_knowledge`, `list_knowledge`, `archive_knowledge`,
`knowledge_history`, `promote`, `deprecate_knowledge`, `review_context`,
`review_list`, `resolve_review`, `review_history`, and `review_archive`.
Writes use atomic file replacement and a shared lock; concurrent writes either
complete or report that the caller should retry. After a crashed writer, stop
the service, verify the PID in `runtime/brain-write.lock` is no longer running,
and remove that lock before restarting.

```sh
agent-brain remember --json '{"scope":"project","type":"observation","title":"Refresh handling","content":"Investigate concurrent refresh requests."}'
agent-brain search "refresh"
agent-brain get ITEM_ID
agent-brain amend ITEM_ID --revision REVISION --json '{"content":"Corrected text."}'
agent-brain deprecate ITEM_ID --revision REVISION "No longer applies"
agent-brain promote ITEM_ID --scope global --revision REVISION --confirmed
```

`amend_knowledge` revises an active item in place, keeping its id, file name, scope,
type, authority, and history, and updating only the fields you pass. Use it to correct
or extend knowledge instead of writing a near-duplicate. Scope, type, authority, and
review severity are not amendable; if one of those is wrong, deprecate the item and
write a corrected one.

#### Knowledge consolidation

Run the consolidation skill from the current project's directory:

```sh
agent-run compress
agent-run compress --dry-run
agent-run compress --agent claude
agent-run compress --scope global
```

This opens the selected agent with the consolidation task and its normal generated
configuration and permission settings. It uses project scope when configured,
otherwise default scope. Global knowledge changes require `--scope global`.
`--dry-run` asks the agent to inspect and propose changes without modifying knowledge.
Agent-brain must be initialized and its service available.

Choose the user default in `<config-root>/agent-run.defaults.jsonc`:

```jsonc
{
  "agent": {
    "default": "codex"
  }
}
```

The same field in a profile's `agent-run.jsonc` overrides the user default;
`--agent` overrides both. Supported values are `codex`, `claude`, `gemini`, and
`grok`. Older manifests without this field use Codex, and initialization preserves
existing configuration and customized skills. Explicit commands such as
`agent-run claude` continue to select that agent directly.

The `brain-consolidate` skill removes repetition, combines focused topic records,
and extracts appropriately classified knowledge from memory. It preserves
requirements, exceptions, authority, sources and useful history. Historical plans
and inferred observations do not become confirmed requirements through compression.
Unresolved contradictions remain visible. Reviews and tasks have separate workflows.

Clear, authoritative corrections in supplied comments or memory are reconciled
into the affected spec sections, preserving unrelated requirements and source
references. A newer timestamp or code comment alone does not establish authority.
Sections explicitly marked immutable or locked are preserved verbatim unless the
user explicitly authorizes changing them. Conflicts with locked sections are
reported while independent updates can proceed. These are skill instructions;
the storage API does not enforce section-level locks.

The command uses an installed skill override when present, otherwise the bundled
skill; `agent-brain init` installs missing built-in skills without replacing existing ones.

`list_knowledge` provides a complete paginated inventory of metadata and content
character counts, with `scope`, `types`, `includeDeprecated`, `offset`, and `limit`
(default 50, maximum 100). It also reports `contextBudget`. Fetch complete records
with `get_knowledge` before editing; search and context results are not inventories.

After writing and verifying replacements with `remember` or `amend_knowledge`,
`archive_knowledge` accepts a request such as:

```json
{
  "sources": [{
    "id": "old-id",
    "revision": "<last-read SHA-256>",
    "replacements": [{"id": "surviving-id", "revision": "<verified SHA-256>"}]
  }],
  "reason": "Combined duplicate requirements; verified all exceptions survive."
}
```

Each source can point to multiple replacements when extracting different categories.
The tool checks all sources and replacements before writing, requires matching scope
and authority, preserves recall coverage, and excludes reviews. The agent verifies
semantic coverage; the tool cannot prove that a summary preserves every fact.
Exact original files and replacement IDs/revisions go into one
`knowledge-history.jsonl` per scope before source files are removed. If deletion
fails, originals remain in history and an identical request can finish deletion
while the supplied revisions still match. History and removed knowledge paths
participate in authorized brain Git sync; compression itself never commits or pushes.

Use `knowledge_history` with an old `id` to retrieve the original file text and
replacement references. Without `id`, it returns compact metadata; optional
`scope`, `query`, `offset`, and `limit` support browsing. Follow replacement IDs
through history if those records were later consolidated. Archived originals stay
out of normal retrieval. This reduces active files and context text, while retaining
archive bytes on disk.

The corresponding CLI commands accept the same JSON options:

```sh
agent-brain list --json '{"scope":"project","offset":0,"limit":50}'
agent-brain history --json '{"id":"old-id"}'
agent-brain archive --json '<sources-and-replacements-object>'
```

#### File names

`remember` names each file after the item id. Pass `filename` to choose the name
instead, as lower-case words separated by single dashes and no extension:

```sh
agent-brain remember --json '{"scope":"project","type":"observation","title":"Build flow","content":"...","filename":"build-flow"}'
```

If that name is taken, the item id is appended rather than overwriting anything. The
name is storage only and is never written into the metadata: the `id` in the front
matter is the identity, so files stay safe to rename by hand and the item is still found
by id afterwards.

#### Review findings

Review knowledge is a numbered, prioritized list. `remember` requires a
`severity` of `critical`, `high`, `medium`, or `low` when the type is `review`,
and rejects `severity` for every other type. The store assigns the finding
label itself: `C1`, `H1`, `M1`, `L1`, counting up per severity within the scope.
Resolved numbers are never handed out again, so a label always refers to the
same finding.

Each finding also carries a `state` of `open`, `fixed`, or `wontfix`, separate
from the `active` and `deprecated` status that controls recall. New findings
start `open`.

```sh
agent-brain review list
agent-brain review list --severity high --state open
agent-brain review resolve ITEM_ID --revision REVISION --state fixed "Fixed by using a stable command name"
```

`review_list` returns findings in severity then number order, open ones only
unless states are given, each with the revision needed to resolve it.
`resolve_review` records the state and reason and takes the finding out of active
recall. It writes a short record (label, title, outcome, date, reason, and original
file/revision) to the scope's `review-history.jsonl`, then deletes the full finding
file. `review-counters.json` preserves numbering. These files participate in brain
Git sync but are excluded from normal knowledge retrieval.

Use MCP `review_history` to recall old fixes, with optional `query`, `scope`, `state`,
`offset`, and `limit` (default 100). The CLI equivalent is
`agent-brain review history [query]`. Git retains full details only when the original
files were committed before cleanup; the MCP history is sufficient for the short fix list.
Use `review_archive` with a scope, or `agent-brain review archive --scope project`,
to compact existing files already marked `fixed` or `wontfix`. Deferred findings
remain open. Mark a finding `wontfix` only when the user explicitly drops it or
confirms it is intentional. A request to postpone an issue does not close it.

Finding labels are indexed, so `search_knowledge` for `H2` finds that finding.
Review files written before these fields existed keep parsing; they simply carry
no label and stay out of the finding list.

Remembered deductions default to inferred authority and must remain observations,
memories, or review records. Global writes require explicit user authority.
Promotion copies an item, records its origin, preserves the original, and requires
confirmation. Deprecation and promotion require the last-read revision so stale
requests cannot overwrite newer work. An agent's authority claim is an instruction
contract, not a separate authentication system; the Unix account owns the data.

Skills use YAML `name` and `description` metadata in `skills/<name>/SKILL.md`.
`list_skills` returns descriptions, and `get_skill` loads the body on demand.
A project/default skill overrides a global skill with the same name. Add
`extends: global:NAME` to include the global skill's instructions before the local
instructions. The existing native skill-template system continues to work.

Skill templates and their includes must stay under `global/skills/` or the active
project/default profile's `skills/` directory. Use config-root-relative paths such
as `{% include "global/skills/shared/checks.md" %}`, or `./` paths relative to the
including template. Nunjucks variables remain available. Symlinks are rejected,
and each file is limited to 1 MiB. Move snippets and skill overrides stored
elsewhere into these directories before rendering or loading those skills.

The packaged memory, consolidation, review and task skills document their workflows. New review findings belong in GitHub Issues through `code-review`.

### Tasks and connectors

Tasks are separate from knowledge and stored in `todo/<id>.md`. Supported states
are `todo`, `doing`, `blocked`, `done`, and `cancelled`. Tasks have titles,
descriptions, priorities, owners, due dates, labels, notes, and optional external
source identities.

```sh
agent-brain todo add --json '{"scope":"project","title":"Check refresh handling","priority":"high"}'
agent-brain todo list
agent-brain todo get ITEM_ID
agent-brain todo complete ITEM_ID --revision REVISION
```

MCP exposes `todo_list`, `todo_get`, `todo_add`, `todo_update`, `todo_complete`,
`todo_import`, and `todo_sync`. Update requests require the current revision.

Configure optional connectors in `brain.jsonc`:

```jsonc
{
  "enabled": true,
  "connectors": {
    "issues": {
      "type": "github",
      "repository": "my-org/my-project",
      "tokenEnv": "GITHUB_TOKEN"
    },
    "board": {
      "type": "trello",
      "board": "BOARD_ID",
      "keyEnv": "TRELLO_API_KEY",
      "tokenEnv": "TRELLO_TOKEN"
    }
  }
}
```

```sh
agent-brain todo import issues --scope project
agent-brain todo sync issues --scope project
```

Credentials are read from the process environment and never written to task files.
Set credentials in the service's environment.
GitHub imports paginate and exclude pull requests. Trello maps due-complete cards
to done, archived cards to cancelled, and other cards to todo; it does not guess
workflow states from list names.

Imports deduplicate by source identity and scope. Synchronization compares local
and remote fields against the last imported version, preserves local-only edits,
and reports conflicting task IDs without replacing those tasks. Deleted remote
items are retained locally. These connectors only read remote systems; completing
a local task does not close a GitHub issue or modify a Trello card.

### Git portability

For remote Brain, asking “brain sync” or “brain flush” invokes the MCP tool to export, commit
and push canonical knowledge to the configured private repository. Exiting a
wrapped agent session invokes the same flush automatically. Failures produce a
warning and preserve live data; they do not change the agent exit status. A new
sync retries from the latest Git revision. Force-killed processes cannot flush;
use `brain sync` in chat before disconnecting when needed.

Remote export covers the active repository and shared scopes for which the token
has full write access. Findings additionally require review permission. Client
settings, server paths, credentials, generated files and MCP-owned skills are
excluded. Competing Git edits are reported without overwriting either side.

The following commands describe the separate local configuration Git workflow.

```sh
agent-brain sync status   # Preview Git status and eligible files
agent-brain sync init     # Initialize the configuration Git repository
agent-brain save          # Commit local brain changes and push
agent-brain pull          # Pull remote changes with rebase
agent-brain push          # Push existing commits
agent-brain sync          # Commit local changes, pull, then push
```

Commands need no `--confirmed` flag. Saving generates a commit message from the
number of changed files; use `--message "Your message"` to override it. Output
reports completed steps, including a local commit if a later pull or push fails.
Existing `agent-brain sync save|pull|push` forms remain supported. Bare
`agent-brain sync` now performs synchronization; use `sync status` for a preview.

From an agent prompt, use `brain sync` or `brain flush`. The MCP tools
`brain_sync` and `brain_flush` accept an optional message; older `sync` and
`flush` tool names remain compatibility aliases. A bare “sync” or “flush” does
not identify Brain as the target. Agents still need a user request or standing
authorization to sync.

Saving includes Markdown knowledge, skills, tasks, project metadata, and `.gitignore`.
It also includes all regular files under each scope's `templates/` directory,
including nested Nunjucks templates and supporting files. Template additions,
edits, and deletions are synced; symlinks are rejected.
It excludes indexes, runtime state, secrets, `brain.jsonc`, and native agent
configuration. Existing staged changes block a save. Configure the remote and
upstream with normal Git commands using your existing credentials.
Brain Git operations use `AGENT_RUN_REAL_PATH` when available, so agent-session
Git guards do not intercept configuration sync.
After cloning onto another machine, run `agent-brain init` to restore generated
profile markers and shared templates, then update source roots in `config.yaml`
to match that machine.

The configuration directory must itself be the repository root. Pull uses rebase
and reports conflicted files; resolve the rebase before syncing again. Sync stops
on failure without pushing. Commands apply across all scopes in the configuration
repository, not just the current code project. Background commits and pushes are
not performed; the service can optionally pull at startup as described below.

### Persistent service under apicore-server

All native agents connect to the same long-lived service for the current user.
Start it on Linux, macOS, or Windows:

```sh
agent-brain serve
```

The service hosts SDK Streamable HTTP at `/mcp` using apicore's Fastify instance.
It listens on `<config-root>/runtime/agent-brain.sock`, which defaults to
`~/.agent-run/runtime/agent-brain.sock`. Both the service and clients use the
configured root regardless of their environment. The socket
directory must belong to the current user and have mode `0700`; the socket has
mode `0600`. No TCP listener or application user database is created.

Generated native-agent configurations run `agent-brain mcp` through `PATH`, so
`agent-brain` must be installed and available there. The bridge selects the socket
when it starts; generated files do not depend on the installation or runtime
directory used to render them. Re-render existing profiles with `agent-run update`
to replace older commands that contain absolute installation paths. After
upgrading from a version that used a different socket location, restart the service and
agent sessions so they use the socket under the configuration root.

`agent-run mcp` also bridges native-agent stdio to this socket. Use `--socket PATH`
for a particular service. The bridge verifies the socket's ownership and private
permissions. A missing or unreachable socket is an error; start the service
before connecting. There is no standalone stdio server or TCP fallback. Apicore
supports Unix sockets directly, so localhost binding is unnecessary. The brain
service supports Linux, macOS, and native Windows.

On Windows the default endpoint is `\\.\pipe\agent-brain-<hash>`, derived from
the user's home and configuration root. No TCP port is opened. Windows
PowerShell applies a private pipe ACL before requests are accepted; each bridge
checks the pipe owner and ACL before connecting. `--socket` can select another
local named pipe. Windows removes the pipe automatically when its server exits.

To start it automatically at Windows sign-in, initialize the desired config root
and run the packaged installer in PowerShell:

```powershell
agent-brain init --configdir "$env:USERPROFILE\.agent-run"
$prefix = npm.cmd prefix -g
& "$prefix\node_modules\@technomoron\agent-run\scripts\install-windows-brain.ps1" -ConfigRoot "$env:USERPROFILE\.agent-run"
```

The `Agent Brain` scheduled task runs hidden as the signed-in user, without
elevation, and retries failures. Its log is `<config-root>/runtime/service.log`.
After upgrading the package, restart it with `Stop-ScheduledTask` followed by
`Start-ScheduledTask` for task name `Agent Brain`.

After a crash, remove a stale socket only after checking that its service is
stopped. Starting a second service on an existing socket fails without replacing
the first service's socket.

For a user service, copy `ops/systemd/agent-brain.service` to
`~/.config/systemd/user/` and adjust `ExecStart` if your executable is elsewhere.
Add `--configdir PATH` to `ExecStart` if you use a custom configuration root.
Run `systemctl --user daemon-reload` followed by
`systemctl --user enable --now agent-brain`. Installation is explicit.

The supplied service uses `serve --pull`. On startup this pulls the configuration
repository with `--ff-only --no-rebase` when it is clean and has an upstream.
Dirty checkouts and missing upstreams are skipped. Divergence or network failures
are reported in the service journal and the service continues with local files.
Before launching any configured agent, agent-run initializes its enabled brain MCP connection and calls `brain_status`. If this fails, launch stops with the underlying error. A disabled brain MCP connection also blocks launch when brain is enabled. Run the agent and brain service as the same user; private socket ownership is enforced. `--none` remains an explicit configuration bypass.

Startup never commits, pushes, stashes, or rebases local work. Omit `--pull` to
disable this behavior for a manually launched service.

The AI tools updater can install and restart the service for explicitly selected
accounts; see [agent-run Systemd Jobs](https://github.com/technomoron/agent-run#systemd-jobs). Existing user unit
overrides still take precedence over the installed system-wide user unit.

Each HTTP request resolves the proxy's source directory through agent-run's
resolver. Tools cannot select another project's scope through arguments. The
service shares canonical files and the SQLite index; it does not keep a watcher
or a separate authoritative cache.

### Remaining roadmap

The initial implementation uses lexical retrieval and path matching. Embeddings,
vector ranking, background watchers, debounced automatic Git synchronization,
remote task writes, and additional connectors remain future work. No model
provider or external account is required for the local features.

Transport and connector implementations follow the
[Node MCP SDK server documentation](https://ts.sdk.modelcontextprotocol.io/server),
[GitHub Issues REST API](https://docs.github.com/en/rest/issues/issues), and
[Trello board API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/).
