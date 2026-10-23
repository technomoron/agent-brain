---
name: git-workflow
description: Inspect Git changes, prepare commit messages, commit, and push within the user's authorization; enforce attribution and repository hygiene rules.
---

Inspect status and the diff before staging. Preserve unrelated work; stage only the authorized scope unless the user explicitly asks to commit everything.

Do not commit, push, tag, publish, or release without explicit user authorization. Reuse authorization already given; do not ask again for the same action. Before committing, show the changed files and exact commit message. Use the release skills for versioning, publishing and releases.

Write short, plain commit messages without category prefixes unless requested or required by the project. Never add AI-related attribution or mentions to commit messages or source code, and never add agent author or coauthor identities. Preserve the user's configured Git identity.

Keep agent configuration and generated runtime files outside project repositories. Do not stage agent-only files or add agent-only ignore entries. Follow the global agent-file-storage constraint when available.

Run configured project checks and relevant tests before committing. Resolve failures or clearly report blockers; do not claim unrun checks passed. For an authorized push, inspect the branch and upstream, push without rewriting shared history, and verify the result. Report commit IDs, push status, and any remaining changes.
