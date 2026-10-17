---
name: code-review-organizer
description: Use for code reviews and review follow-up. Maintains one cumulative list of open findings across all reviews as numbered, prioritized agent-brain items.
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


# Code Review Organizer

Review findings live in agent-brain as a numbered, prioritized list. Each finding is one
knowledge item of type `review` with a severity, and the store gives it a label. There is
no consolidated review file, no dated review file, and no done file. Never write review
notes into the project repository.

If agent-brain is unavailable, say so and report the findings in the reply. Do not fall
back to writing review files.

## One cumulative list

There is a single list of open findings for the project. It is not per review. A finding
raised in any earlier review stays on it until someone actively closes it, no matter how
old it is or which session raised it. Nothing ages out, and nothing is dropped for being
stale, minor, or inconvenient.

Every review updates that whole list, not just the part it happened to touch.

## Before reviewing

1. Call `review_context` with the task and the paths you are about to review. It returns
   the project constraints, decisions, and path-specific knowledge that apply.
2. Call `review_list` for every open finding, from every past review. This is your
   starting list, and you are responsible for all of it, not only what you add today.
3. Re-check each open finding against the current code. Code moves, so a finding can be
   already fixed, partly fixed, changed shape, or wrong.
   - Still accurate: leave it alone.
   - Details drifted, such as moved line numbers or a changed mechanism: `amend_knowledge`
     so the finding matches the code as it is now.
   - Fixed by an authorized task: close it after relevant verification.
   - Looks wrong or appears fixed by unrelated work: present the evidence for the user to decide.
4. Read the generated agent instructions for the project.
5. Do not re-report something already on the list. Amend the existing finding instead of
   raising a second one for the same defect.

## Saving findings

One `remember` call per finding, with `type: review` and `authority: inferred`. A finding
is a suspicion until the user confirms it; never save one as a constraint, rule, or
decision without being asked.

- `severity`: `critical`, `high`, `medium`, or `low`. Required for reviews, and rejected
  on every other type. Judge it by what happens if the defect is left alone, not by how
  much code it touches. Data loss, credential exposure, and corruption are critical or
  high. Style, dead code, and small inefficiencies are low.
- `title`: the claim in one line, no label prefix. The store assigns the label.
- `content`: what is wrong, the file and line, how it fails in practice, and what would
  fix it. Include a reproduction when you have one, and say plainly whether you confirmed
  the failure or are reasoning from the code.
- `applies_to`: the files the finding is about. This is the field that earns its keep, as
  the finding resurfaces through `get_context` the next time anyone works on those files.
- `tags`: the review date as `YYYY-MM-DD` and the component.

Do not put the label in the title yourself and do not pass one. `remember` returns the
assigned `finding` (`C1`, `H1`, `M1`, `L1`), numbered per severity within the scope.
Numbers are never reused, so a label always means the same finding.

Save the session record separately, as `type: memory`, not as a review. It covers what was
reviewed, at which commit, which checks you ran, and what they returned, including checks
that failed or that you could not run. Keep it short; the findings carry the detail.

Call `remember` one at a time. Brain writes take an exclusive lock, so concurrent calls
fail with a lock error rather than queueing. The failure is clean and writes nothing.

`remember` names each file after the item id. That is expected. Do not rename or hand-edit
those files as part of a review.

## Reporting

Report the whole open list, every time, most severe first, with the label, the file and
line, and the claim. That means findings carried over from earlier reviews as well as
anything new, in one list. `review_list` already returns them in that order. Never report
only the findings from the current session: the user should be able to read the reply and
see everything that is open, without going back through old sessions.

Mark new findings clearly. Report findings closed during the task separately with the change and verification. Propose closure for findings whose status still needs a user decision.

The saved items are the record; the reply is how the user reads them. State which checks
you ran and what they returned.

## Follow-up

When the user says "in code review", "review finding", "check H1", "fix M2", "address
C1/C2", or names a label like `C1`, `H1`, `M1`, or `L1`, they mean a saved finding, not a
GitHub pull request comment. Only use GitHub review tools if the user explicitly mentions
GitHub, pull requests, review comments, or CI.

To act on one:

1. `review_list` for the open findings, or `search_knowledge` with the label if you want a
   specific one. Labels are indexed, so searching `H2` finds it.
2. `get_knowledge` for the full text and its current revision.
3. Read the files and lines it names, and confirm the finding still stands before acting
   on it. Findings go stale.

## Resolving a finding

A request to fix a finding authorizes closing it as `fixed` once the change is complete
and relevant checks pass. A request to clean up finished findings authorizes closing
verified completed fixes and compacting existing closed records. Do not ask again for
permission already given. Record limitations when a relevant platform could not be tested.

Call `resolve_review` with the id, current revision, state, and a short reason:

- `fixed`: what changed and how it was verified.
- `wontfix`: the user's decision to drop, reject, or accept the finding and why.

Postponing an issue ("later", "ignore for now") keeps it open. Do not close an issue
because of age, severity, or convenience. If you merely suspect unrelated work fixed it,
verify and propose closure rather than silently dropping it.

Closing writes a compact record to the scope's `review-history.jsonl` and removes the
full finding file. Separate counters preserve labels. Use `review_archive` with an
explicit scope when asked to clean up previously closed files. It leaves unresolved
findings alone. Never make separate done lists or copies of full finished findings.

Use `review_history` for old fixes and dropped findings; filter by query (label, id,
title, or reason), scope, or state, and paginate with offset/limit when needed. Ordinary
review_list, get_context, and knowledge search are for current work. If a requested
label is absent from review_list, check review_history before claiming it is missing.
Git can retain full details only if the original files were committed before cleanup.
Closing findings does not authorize a Git commit, push, or changes to remote issues.
