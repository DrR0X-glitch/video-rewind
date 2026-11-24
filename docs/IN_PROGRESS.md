# Current Task Register

Live register of work currently in progress or waiting in the backlog. Remove completed tasks instead of keeping a history here; use git history for that.

## In progress

| ID      | Task                          | Notes                                                                                                             |
| ------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| DVD-005 | Plan next-version feature set | Roadmap and modular-monolith decision drafted; next planning pass should refine scope and add timeline estimates. |

## Backlog

| ID      | Task                                    | Notes                                                                                                                                                                                 |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DVD-007 | Expand domain test coverage             | Add focused server, database, and browser tests as each product domain is implemented or substantially changed.                                                                       |
| DVD-008 | Prepare deployment cutover              | Keep deployment on hold until the roadmap is complete and staff authentication is ready; rehearse migration and recovery before cutover.                                              |
| DVD-014 | Add staff-only CD catalog with Discogs  | Use a separate release model; persist confirmed CC0 metadata/tracks per release with attribution and direct link. Server-side env template includes User-Agent and consumer key/secret; fetch permitted non-CC0 art only on release pages, with browser cache capped at six hours and no app/server cache. |
| DVD-017 | Extract catalog and stock read services | Move the title visibility and stock projection queries touched by format support from `lib/server/store.ts` into catalog/inventory query services.                                    |

## Register rules

- Update this register before every commit that includes related work.
- Remove a task when the commit completes it.
- Add testing, follow-up, and newly discovered bugs as separate current tasks.
- Include domain-aligned extraction of touched `lib/server/store.ts` behavior in each feature task; avoid a separate whole-file rewrite.
