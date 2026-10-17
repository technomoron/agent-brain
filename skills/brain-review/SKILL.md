---
name: brain-review
description: Review changes against project constraints and previous findings,
  and save confirmed review knowledge.
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



Call review_context with the task and changed paths. Check correctness, security, architecture, and meaningful test coverage against relevant constraints. Report concrete, actionable findings with severity and file references. If authorized to save the review, call remember with type=review. Keep suspected hazards marked inferred. Never convert a finding into an authoritative constraint without user confirmation.


Use review_list for current findings and review_history for old fixes or dropped findings.
After completing an authorized fix and relevant checks, call resolve_review as fixed
with a short change and verification summary. Use wontfix only for an explicit user
decision; deferred issues stay open. Closing saves compact history and deletes the full
finding file. For requested cleanup, review_archive compacts already closed files in the
specified scope. Do not create separate full archives or done lists. Git commits and
remote issue updates require their own authorization.
