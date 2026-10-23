---
name: package-integrity-check
description: Use before package releases and publish-ready changes to verify package metadata, release notes, lockfiles, workflows, git state, and agent-file hygiene.
---

# Package Integrity Check

Use this skill for release and package policy checks that are not covered by normal project test commands.
For package release or publish-ready work, verify the relevant package directory before finalizing:

- The directory contains `package.json` and is inside a git repository.
- The repository path follows `<org>/<repo>`, and `package.json.name` is `@<org>/<package-dir-name>`.
- `package.json.version`, `package.json.license`, and `package.json.copyright` are present and non-empty.
- A package-local `LICENSE` file exists and contains the exact copyright string from `package.json.copyright`.
- A package-local changelog exists, named either `CHANGES.md` (preferred) or `CHANGES` (legacy). Exactly one of the two, never both.
- The first `Version ...` line in that changelog matches `Version <package.json.version> (<YYYY-MM-DD>)`.
- The year in the top changelog version line appears in `package.json.copyright`.
- The git `origin` remote matches `<org>/<repo>`.
- The current branch has an upstream configured and is in sync with it after fetching.
- The repository does not contain agent files or directories such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `codex.md`, `.claude`, `.codex`, `.gemini`, or `.grok`.
- The repository root has a lockfile: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`, or `bun.lock`.
- Every GitHub Actions `uses:` reference is pinned to a full commit SHA. The pinned `actions/setup-node` release is v6-compatible and workflows use `node-version: 24`.
- GitHub workflows do not reference `node20` or `node22`.
- The git working tree is clean for files under the checked package directory.
- If files beyond the changelog changed in the checked package directory, that package changelog is also changed.

Run the checks configured for the active project after this checklist. Report failures and checks that could not be run.
