# Current Task Register

Live register of work currently in progress or waiting in the backlog. Remove completed tasks instead of keeping a history here; use git history for that.

## In progress

| ID      | Task                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DVD-005 | Plan next-version feature set | Roadmap and modular-monolith decision drafted; next planning pass should refine scope and add timeline estimates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DVD-014 | Add staff-only CD catalog     | Discogs/manual release schema, providers, APIs, track persistence/search, stock integration, dev-only intake, and tests are in place. Release setup now includes a required sort title before the copy step. CD intake shares saved physical-copy defaults with movie intake. CD stock has a separate no-art view, while `/inventory/cds` searches album titles or songs and links to local release detail. CD copies bypass review through the shared reviewed flag. Exact-edition art uses browser-only six-hour caching. Staff auth is still required before production; UPC lookup is deferred. |

## Backlog

| ID      | Task                               | Notes                                                                                                                                                                                                  |
| ------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DVD-007 | Expand domain test coverage        | Add focused server, database, and browser tests as each product domain is implemented or substantially changed.                                                                                        |
| DVD-008 | Prepare deployment cutover         | Keep deployment on hold until the roadmap is complete and staff authentication is ready; rehearse migration and recovery before cutover.                                                               |
| DVD-017 | Extract catalog visibility queries | Stock read queries and helpers now live in `lib/server/inventory/stock-queries.ts`; extract the remaining title visibility and browse/detail queries from `lib/server/store.ts` into catalog services. |

## Register rules

- Update this register before every commit that includes related work.
- Remove a task when the commit completes it.
- Add testing, follow-up, and newly discovered bugs as separate current tasks.
- Include domain-aligned extraction of touched `lib/server/store.ts` behavior in each feature task; avoid a separate whole-file rewrite.
