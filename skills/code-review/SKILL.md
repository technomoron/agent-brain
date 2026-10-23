---
name: code-review
description: Review code and track actionable findings as GitHub issues; follow up on existing issues and verify fixes.
---

Use brain for project constraints and context; use GitHub Issues as the record of findings.

1. Confirm the repository and requested review scope. Retrieve relevant brain context, inspect the changes, and run checks that help verify suspected defects.
2. Search existing GitHub issues before creating findings. Read matching issues and update the existing issue when it describes the same problem.
3. Report actionable defects with severity, evidence, affected file links, and reproduction or verification steps. Distinguish confirmed failures from suspected risks.
4. When authorized to save findings, use the available GitHub connector or `gh` to create or update ordinary issues. Use issue numbers as identities, existing severity labels or an agreed issue field, and the issue body for evidence. Preserve unrelated content and discussion. Do not create a second brain record or private metadata block.
5. For follow-up, read the current issue and relevant code. After an authorized fix passes relevant checks, record the verification and close the issue as completed. Close as not planned only on the user's decision; deferral leaves it open.

Report findings and issue links relevant to the requested scope, checks performed, and limitations. Reassess unrelated backlog only when requested. GitHub owns issue history; no separate review files, archive, or severity-based numbering is needed.

A request to review code permits inspection and a report; it does not itself authorize creating GitHub issues. Reuse authorization already given. If GitHub access is unavailable, report findings in the reply and state that they were not saved. Do not silently switch to the legacy brain review backend. Historical C1/H1 references require locating the old record; they are not GitHub issue numbers.
