# agent-mcp

Project knowledge, skills, reviews and tasks through MCP. Extracted from agent-run. Requires Node.js 24 or newer.

The package provides both `agent-mcp` and the compatible `agent-brain` command. Existing `brain.jsonc`, source-root registrations, Markdown storage, MCP server names and per-user sockets remain compatible. No knowledge or profile files are moved by installing this package.

## Development

Keep the agent-run and agent-mcp checkouts next to each other. Build agent-run first, then install this package’s dependencies and link the local agent-run checkout:

```sh
cd ../agent-run
pnpm install
pnpm build
cd ../agent-mcp
pnpm install
node scripts/link-agent-run.cjs
pnpm build
```

Run `pnpm test` for the server and agent-run integration suite. The test harness supplies this checkout’s executables through an isolated temporary PATH. Run `npm run build` to check the npm build path.

The server currently depends on `@technomoron/agent-run` for profile resolution, initialization and Nunjucks skill rendering. This preserves existing behavior while moving server ownership into this repository; it does not yet make the server independent of the launcher’s profile format. Local development must link the modified agent-run checkout, which emits declarations for these libraries.

## Running

```sh
agent-mcp init --configdir /path/to/agent-config
agent-mcp serve --configdir /path/to/agent-config
```

Agents continue to use `agent-brain mcp --configdir ... --cwd ...`. Agent-run’s `mcp`, `create` and `project` commands delegate to `agent-mcp` on PATH. Install the server separately before using those commands or knowledge compression.

Operational systemd and Windows installation scripts remain in agent-run, which orchestrates the native agent environment. See agent-run’s README for the storage model, CLI operations, permissions and service installation.

## MCP-owned skills

The server owns the Markdown sources under `skills/`: `brain-consolidate`, `brain-import`, `brain-memory`, `brain-review`, `code-review-organizer`, `review-items`, and `todo-manager`. These were extracted from the current external shared skill set on 2026-10-16. The project-specific consolidation copy was identical and is represented once.

Initialization reads these packaged sources and installs missing skills into the external global skill directory. Existing customized installations are preserved. Consolidation’s CLI fallback also reads its packaged Markdown source; there is no separate embedded copy of that workflow. The existing ordinary-conversation retrieval and task-authorization guards are retained in the packaged memory and task skills.

Keep MCP-owned skills and tools with this implementation. Independent reusable skills belong in the private catalog. The live configuration is unchanged by the source extraction; use initialization explicitly when installing missing packaged skills.

## Shared skill catalog

`technomoron/agent-mcp-skills` is the private source catalog for reusable skills. This extraction does not implement Git catalog fetching, refresh schedules, grouped selection or customer-level scopes. Existing skills continue to load from external global and project profile directories.

This repository is private and npm publishing is disabled. There is no release or publishing workflow.

## Remote OAuth endpoint

The opt-in remote endpoint requires the accompanying **unreleased apicore** OAuth
changes. For local development, build the existing `../apicore` checkout and run
`node scripts/link-apicore.cjs`; the published apicore 1.0.0 package does not yet
contain these APIs. Reinstallation replaces this development link. No release or
production deployment is implied.

Copy `examples/remote.jsonc` outside the source tree and customize absolute paths.
Create each repository's separate configuration root using `agent-mcp init
--configdir <root> --cwd <checkout>`. Run the server as a dedicated OS user with a
private runtime directory (0700). Supply two different random signing secrets of
at least 32 characters through `MCP_OAUTH_ACCESS_SECRET` and
`MCP_OAUTH_REFRESH_SECRET`. Human passwords are bcrypt hashes supplied through the
configured environment variables; optional TOTP secrets are base32 values enrolled
in the user's authenticator. Enrolment and password management are administrator
operations. Service accounts use confidential client secrets from the environment.
Never put credentials in source control or client command arguments.

Start `agent-mcp serve-remote --remote-config /private/remote.jsonc`. It binds only
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
`review` permits finding changes. Git synchronization, connector imports, archival
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
Old internal findings are not migrated automatically. Packaged review skills
select their backend through `brain_status`; existing customized installations
must adopt that backend-selection section before using GitHub reviews.

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
Legacy separate group roots remain supported when `dataRoot` is absent.
Global writes require a wildcard token and current wildcard write permission.
Pool writes require write permission for every registered member. Reading a
repository includes its global and pool knowledge. Reviews, their counters and
history, tasks, and GitHub issue targets stay with the individual repository.
