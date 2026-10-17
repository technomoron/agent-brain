---
name: review-items
description: MUST use when the user asks to list, show, fix, address, check, resolve, close, or summarize review items, outstanding review issues, review findings, review IDs like C1/H1/M1/L1, or saved code review follow-ups.
---


## Review backend selection

Before conducting a review or modifying findings, call `brain_status`. Its
`reviewBackend` selects the destination. For `github`, findings are issues in the
active repository shown by `repository`; use `review_list`, `review_get`,
`review_create`, `review_update`, `resolve_review`, and `review_history`.
This backend selection takes precedence over internal-storage instructions below.
Do not use `remember`, `get_knowledge`, or `amend_knowledge` for GitHub findings,
and do not create an internal duplicate or silently fall back when GitHub fails.
Each repository keeps its own issues; split findings that affect different repos.
Use a stable, repository-specific retry `key` for `review_create`. Remote writes
require user authorization, enabled GitHub writes, and `confirmed: true` for
creation or updates. Read the current issue revision before updating or closing.
Preserve discussion outside the managed finding block. Closing requires verified
fixes or the user's explicit decision to drop a finding; deferral leaves it open.
GitHub retains closed history, so do not call `review_archive` for this backend.
For `internal`, retain the existing knowledge storage and closure workflow below.
Read-only listing can call `review_list` or `review_history` directly without
loading this workflow. Never enable writes or migrate old findings implicitly.


# Review Items

Saved review labels refer to agent-brain findings, not GitHub issues or PR comments,
unless the user explicitly gives that context. Follow code-review-organizer for the
review workflow and closure rules.

Use `review_list` for open findings, then `get_knowledge` for a finding's details and
current revision. Inspect the referenced code before acting. Use `review_history` to
recall fixed or dropped findings, including labels absent from the open list.

Finish an authorized fix with relevant checks and `resolve_review`, recording what
changed and verification. Explicitly dropped findings use `wontfix`; deferred findings
stay open. Closing stores a compact record and removes the full finding file. Use
`review_archive` with an explicit scope for requested cleanup of already closed files.
Do not create consolidated, dated, or done review files. Brain storage stays outside
the source repository. Git history is optional and commits require separate authorization.
