---
name: code-review
description: Review code and track actionable findings as GitHub issues; follow up on existing issues and verify fixes.
---

GitHub Issues in the affected repository are the sole authoritative record of review findings, discussion, status and resolution. Read the current issue before follow-up and resolve conflicting copies in favor of GitHub. Never persist findings or duplicate issue backlogs in Brain knowledge/reviews/todos, local Markdown files, review archives or another tracker. Do not use a Brain review-write tool unless its configured backend is verified to write directly to the same GitHub repository. If GitHub is unavailable or saving is unauthorized, report findings only in the reply and clearly state they are unsaved; do not create a fallback store.

Use Brain for project constraints, specifications and reusable knowledge, not issue records. A confirmed general lesson may be saved under the memory workflow, with a link to the GitHub issue, but must not copy the finding or maintain its status elsewhere.

1. Confirm the repository and requested review scope. Retrieve relevant brain context, inspect the changes, and run checks that help verify suspected defects.
2. Retrieve open GitHub issues with origin label `Code Review` by default. Search closed issues and other types when relevant to prior decisions, regressions or duplicate detection. Read matching issues and update the existing issue when it describes the same problem.
3. Report actionable defects with severity, evidence, affected file links, and reproduction or verification steps. Distinguish confirmed failures from suspected risks.
4. When authorized to save findings, use the available GitHub connector or `gh` to create or update ordinary issues. Use GitHub issue numbers as permanent identities instead of H1/M1 numbering. Keep titles descriptive and classify origin and work type separately as specified below. Use the existing organization-level `Priority` issue field with `Urgent`, `High`, `Medium` and `Low` options. Map critical severity to `Urgent`, and high, medium and low severity to the corresponding Priority values. Do not create a separate Severity field or severity/priority labels. If the Priority field cannot be read or set, report the failed operation and retain the assessed severity and intended Priority in the issue body. Put evidence in the issue body and preserve unrelated content and discussion. Do not create a second brain record or private metadata block.
5. For follow-up, read the current issue and relevant code. After an authorized fix passes relevant checks, add an issue fix comment and close the issue as completed. This applies whether a person or AI made the fix. Close as not planned only on the user's decision; deferral leaves it open. Keep resolved issues for history; do not delete them.

Write issue fix comments as a concise bullet list. Each item states what was fixed and links to the corresponding commit. Optionally append the version in parentheses. A single concise note at the bottom may describe how the fix was tested. Do not include headings, introductions, conclusions, deployment status, or unrelated outstanding work. Do not label the list “TL;DR”.

Example:

- Keep content centered when sidebar ads are missing. [7742e93](commit-url) (1.0.46-rc.1)

End each actual code review finding's issue body or review note with this attribution on its own final line:

`Reported by: <agent> (<provider> <model> <reasoning>)`

Example: `Reported by: Codex (OpenAI gpt-6.1-sol default)`

Use the reporting agent's name, provider, exact model identifier and reasoning setting. Use `default` only when the default reasoning setting is known to apply; use `unknown` for any unavailable value rather than guessing. Attribute delegated findings to the agent and model that reported them. This attribution applies only to the text reporting a review finding, never to fix comments, resolution notes or other content. It never overrides any other restriction on AI mentions, agent authorship or coauthors; if an applicable restriction prohibits this attribution, omit it.

When an authorized second opinion differs about an existing review issue, add a separate comment to that issue explaining the differing assessment and supporting evidence. Preserve the original finding and discussion. End the comment with the same attribution format, identifying the agent and model giving the second opinion, subject to the same AI mention restrictions. Do not treat disagreement alone as a fix or close the issue automatically.

Classify issues using three independent fields:

| Field | Allowed values | Rule |
| --- | --- | --- |
| Origin label | `Code Review`, `Bug Report`, `Feature Request`, `ToDo`, `Question` | Exactly one of these labels per issue. |
| Issue type | `Bug`, `Feature`, `Task`, `Inconsistency`, `Question`, `Documentation` | Exactly one; describes the work, not its origin. |
| Priority | `Urgent`, `High`, `Medium`, `Low` | Existing organization issue field, independent of origin and type. |

A defect discovered during review has label `Code Review` and type `Bug`; a user-reported defect has label `Bug Report` and type `Bug`. A requested capability has label `Feature Request` and type `Feature`. A manual task or follow-up task created while fixing a review finding has label `ToDo` and type `Task`; link follow-ups to their original issue. A review finding about contradictory behavior or configuration may use type `Inconsistency`. Work to correct or improve documentation uses type `Documentation`. A question has origin label `Question` and type `Question` unless it originated in a review, in which case retain origin `Code Review`.

Do not use `Code Review` as an issue type. Do not combine origin labels. Do not add category labels such as `bug` or `enhancement` that duplicate the work type. The five origin labels are the entire allowed label set. Do not create or apply additional labels unless the user explicitly requests them. Close as not planned only on the user's decision.

Use the code-review skill for review findings and todo-manager for feature requests and tasks. Filter review lists by origin label `Code Review`, and feature-request lists by origin label `Feature Request`; type `Feature` alone can also include improvements discovered during review.

Keep assessed defect severity in the finding text and map critical severity to Priority `Urgent`, with high/medium/low mapping to the corresponding Priority value. Do not create a parallel Severity field or severity/priority label system. Inspect available types, fields and labels before saving. Create missing origin labels and work types when authorized with the required permissions; report unavailable capabilities rather than silently substituting a different scheme.

Read back saved issues and verify exactly one origin label, the work type and Priority. Report any permission or API limitation explicitly; body text is only a disclosed fallback when Priority cannot be set. During authorized follow-up, check classification too. Do not reclassify unrelated backlog or remove existing fields or labels without authorization.

Report findings and issue links relevant to the requested scope, checks performed, and limitations. Reassess unrelated backlog only when requested. GitHub owns issue history; no separate review files, archive, or severity-based numbering is needed.

A request to review code permits inspection and a report; it does not itself authorize creating GitHub issues. Reuse authorization already given. If GitHub access is unavailable, report findings in the reply and state that they were not saved. Do not silently switch to the legacy brain review backend. Historical C1/H1 references require locating the old record; they are not GitHub issue numbers.

The listed origin labels, work types and Priority options are exhaustive. Do not create or use additional values unless the user explicitly requests them. When authorized to align repositories, remove obsolete entries; check organization-wide entries for use outside the authorized repositories before removal.
