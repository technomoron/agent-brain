---
name: todo-manager
description: Track feature requests and planned work in GitHub Issues without a separate local todo list.
---

Use GitHub Issues in the affected repository as the task backlog. Use the available GitHub connector or `gh`; do not create a separate local todo list or duplicate brain task records.

1. Confirm the repository and requested task. Retrieve open issues of the relevant type by default; search existing open and closed issues before creating a request to avoid duplicates.
2. Create or update issues only when requested or authorized by the current workflow. Use issue numbers as permanent IDs, descriptive titles, and clear requirements or acceptance criteria. Read the current issue before updates and preserve unrelated content and discussion.
3. Use exactly one origin label: `Feature Request` for a requested capability, `ToDo` for a manually added task or a follow-up task triggered by a review issue fix, `Bug Report` for a reported defect, `Question` for a question, or `Code Review` for a review finding. Link review-fix follow-up tasks to the original issue.
4. Set exactly one work type independently of origin: `Bug`, `Security`, `Feature`, `Task`, `Inconsistency`, `Question` or `Documentation`. A feature request normally has type `Feature`; a manual or follow-up task normally has type `Task`. `Code Review` is an origin label, never an issue type. Do not add `bug` or `enhancement` category labels that duplicate type. The five origin labels are the entire allowed label set; do not create or apply additional labels unless the user explicitly requests them. Use the existing `Priority` field (`Urgent`, `High`, `Medium`, `Low`), without creating severity/priority labels or a separate Severity field. Create missing origin labels or work types only when authorized with the required permissions. Read back origin, type and Priority after saving and report unavailable capabilities. Use code-review for review findings. Filter feature-request lists by origin label `Feature Request`, not type alone.
5. Leave unfinished or deferred requests open. After an authorized implementation passes relevant checks, record verification and close the issue as completed. Close as not planned only on the user's decision. Preserve closed issues for history rather than deleting them.

A request to do work does not by itself authorize creating a saved task or GitHub issue. Reuse authorization already given. Do not migrate or delete existing local tasks without authorization. If GitHub is unavailable, report the limitation and unsaved requests in the reply.

The listed origin labels, work types and Priority options are exhaustive. Do not create or use additional values unless the user explicitly requests them. When authorized to align repositories, remove obsolete entries; check organization-wide entries for use outside the authorized repositories before removal.
