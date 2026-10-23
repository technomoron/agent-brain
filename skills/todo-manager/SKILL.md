---
name: todo-manager
description: Track feature requests and planned work in GitHub Issues without a separate local todo list.
---

Use GitHub Issues in the affected repository as the task backlog. Use the available GitHub connector or `gh`; do not create a separate local todo list or duplicate brain task records.

1. Confirm the repository and requested task. Retrieve open issues of the relevant type by default; search existing open and closed issues before creating a request to avoid duplicates.
2. Create or update issues only when requested or authorized by the current workflow. Use issue numbers as permanent IDs, descriptive titles, and clear requirements or acceptance criteria. Read the current issue before updates and preserve unrelated content and discussion.
3. Set feature requests to issue type `Feature` with the `enhancement` label. Use `Task` for other planned work. Create missing types or labels only when authorized with the required permissions; report unavailable capabilities rather than silently substituting a local list.
4. Code review findings use type `Code Review`, never `Feature`; use the code-review skill for that workflow. Filter feature-request lists by type `Feature` so review findings remain separate even when they have an `enhancement` label.
5. Leave unfinished or deferred requests open. After an authorized implementation passes relevant checks, record verification and close the issue as completed. Close as not planned only on the user's decision. Preserve closed issues for history rather than deleting them.

A request to do work does not by itself authorize creating a saved task or GitHub issue. Reuse authorization already given. Do not migrate or delete existing local tasks without authorization. If GitHub is unavailable, report the limitation and unsaved requests in the reply.
