Unreleased (2026-10-23)
-----------------------
* Load all Brain workflows directly from the package instead of installing configuration copies.
* Track reviews and tasks with GitHub issue types and structured severity.
* Serve one bundled code-review workflow using ordinary GitHub issues, with optional local overrides.
* Support plaintext or hashed remote login passwords.

Version 0.1.1 (2026-10-22)
--------------------------
* Allow independent repositories without a pool in configuration deployment and Git sync.

Version 0.1.0 (2026-10-22)
--------------------------
* Extract the project knowledge and skills MCP server from agent-run.
* Serve authenticated remote MCP through HTTPS proxies, using OAuth with
  repository permissions and user, client and token scope restrictions.
* Share knowledge across explicitly configured repository pools while keeping
  repository reviews, issues and project knowledge separate.
* Discover repositories permitted for the authenticated user and bind sessions
  to the selected repository.
* Synchronize canonical knowledge through Git with brain sync and brain flush,
  retaining live data and reporting push or merge conflicts.
* Deploy configuration updates from GitHub with validation and rollback.
* Bundle Brain administration and GitHub issue skills with the server.
* Verify launcher integration using the installed agent-run package.
