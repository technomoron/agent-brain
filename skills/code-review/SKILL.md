---
name: code-review
description: Review code and track actionable findings as GitHub issues; follow up on existing issues and verify fixes.
---

Use brain for project constraints and context; use GitHub Issues as the record of findings.

1. Confirm the repository and requested review scope. Retrieve relevant brain context, inspect the changes, and run checks that help verify suspected defects.
2. Retrieve open GitHub issues with type `Code Review` by default. Search closed issues and other types when relevant to prior decisions, regressions or duplicate detection. Read matching issues and update the existing issue when it describes the same problem.
3. Report actionable defects with severity, evidence, affected file links, and reproduction or verification steps. Distinguish confirmed failures from suspected risks.
4. When authorized to save findings, use the available GitHub connector or `gh` to create or update ordinary issues. Use GitHub issue numbers as permanent identities instead of H1/M1 numbering. Keep titles descriptive and labels for categories such as bug or enhancement. Set an organization-level Severity field with Critical, High, Medium and Low options; create it when missing and authorized with the required permissions. If the field cannot be configured, report the limitation rather than silently substituting severity labels. Put evidence in the issue body and preserve unrelated content and discussion. Do not create a second brain record or private metadata block.
5. For follow-up, read the current issue and relevant code. After an authorized fix passes relevant checks, record the verification and close the issue as completed. Close as not planned only on the user's decision; deferral leaves it open. Keep resolved issues for history; do not delete them.

Set review findings to issue type `Code Review`, never `Feature`, including findings labeled `enhancement`. Feature requests belong to todo-manager with type `Feature`. Create the organization-level `Code Review` type when missing and authorized with the required permissions. If issue types are unavailable, report the limitation; do not silently substitute a label or classify a review as a feature.

Use these standard labels where applicable:

- `bug`: incorrect behavior; `enhancement`: an improvement or new capability; `documentation`: documentation changes; `question`: clarification needed.
- `duplicate`: an existing issue already tracks the finding; link that issue. `invalid`: the reported problem is not valid. `wontfix`: the user decided not to address it.
- `help wanted`: outside help is requested; `good first issue`: a bounded task suitable for a newcomer.

Reuse existing equivalent labels and create missing standard labels only when authorized with the required permissions. Apply only relevant labels, preserve unrelated labels, and keep severity in the Severity field.

Report findings and issue links relevant to the requested scope, checks performed, and limitations. Reassess unrelated backlog only when requested. GitHub owns issue history; no separate review files, archive, or severity-based numbering is needed.

A request to review code permits inspection and a report; it does not itself authorize creating GitHub issues. Reuse authorization already given. If GitHub access is unavailable, report findings in the reply and state that they were not saved. Do not silently switch to the legacy brain review backend. Historical C1/H1 references require locating the old record; they are not GitHub issue numbers.
