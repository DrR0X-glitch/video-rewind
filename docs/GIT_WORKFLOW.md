# Git workflow

## Branch names

Use a purpose prefix and a short, lowercase, hyphen-separated description:

- `feature/<description>` for new product behavior.
- `bugfix/<description>` for correcting existing behavior.
- `chore/<description>` for documentation, tooling, refactors, dependencies, and maintenance.

Examples: `feature/manage-locations`, `bugfix/stock-selection`, `chore/versioned-migrations`.

Use only these three prefixes for ordinary work. Do not add release, hotfix, ticket, or agent prefixes unless the user asks. Keep a branch as broad as a cohesive change: one branch can contain multiple related features or bugs intended for the same review and merge; split unrelated work when it makes review or rollback clearer.

This follows the purpose-prefix and lowercase kebab-case approach in [Conventional Branch](https://conventionalbranch.org/), using only the development prefixes needed for this repository.

## Working rules

1. At the start of a session where Git changes are planned, read this document once. It does not need to be reread before each individual change in that session.
2. Check the current branch and working tree before editing. Preserve existing user changes; do not discard or overwrite them to get a clean tree.
3. Unless the user explicitly says otherwise, create or switch to a correctly prefixed branch before making changes. Never make project changes directly on `main`.
4. Keep changes for a cohesive task on that branch. Commit on the branch after updating `docs/IN_PROGRESS.md`.
5. Before merging to `main`, bring the branch up to date with `main`, review the complete diff, and run the full local verification gate below on the exact branch tip.
6. Merge only when every required check passes. If a check fails or was not run, fix it or report the blocker; do not treat it as a pass.
7. Run the full verification gate again on `main` after the merge. No CI is configured or required by this workflow.
8. Remove the completed task from `docs/IN_PROGRESS.md` before the commit that completes it; record remaining work as separate active or backlog items.

## Local verification gate

Run these before every merge to `main`:

```sh
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test
pnpm build
```

The test command must cover both server-side and browser-side unit tests. Run the database integration suite as well when a change touches schema, queries, migrations, seeds, or database behavior. These checks run locally; do not add CI unless the user requests it.
