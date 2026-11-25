# Staff CD Catalog and Track Search

**Status:** In progress on `feature/discogs-cd-catalog`. Schema, provider, server catalog services, stock projections, local verification, and the initial intake UI are in place. Remaining UI work is release detail and track search.

## Direction so far

- Keep CDs staff-managed and out of public catalogue pages.
- Use Discogs for selecting the exact CD release/pressing. Add the Discogs integration on a separate feature branch because the current title model is TMDB-specific.
- Allow staff to create a manual release when Discogs has no exact match; manual entries must be marked as manual and must not claim Discogs attribution.
- Store the selected Discogs release once, then link each physical inventory copy to it. Copies of the same Discogs release share one metadata row and one track list.
- Store a compact track list locally so staff can search for a song across the collection and list tracks on a release page.
- Treat the existing `inventory_items` record as the physical copy: its UPC/EAN, location, availability, condition, price, and stock history remain per copy.
- Make CD intake parallel to the existing create-title page. Reach it through a small CD link beside that page's heading; do not add a top-level navigation item.

## Fit with the current architecture

The existing `titles` table and `inventory_item_titles` relationship represent TMDB movies and series. Their identifiers, media types, collection queries, and public pages assume video. Adding album fields and Discogs identifiers to that table would spread music-specific behavior through those paths.

Add a separate music catalog domain instead:

1. `music_releases` represents a specific Discogs release ID, not only the broader master album. Different pressings can have different barcodes or track listings, so they remain distinct records. Every release has a required sort title, defaulted from its display title and editable during the release setup step.
2. `music_release_tracks` stores ordered track entries once per release.
3. `inventory_item_music_releases` links a physical CD copy to its selected release. Multiple copies can point to the same release.
4. `inventory_items.format = 'cd'` identifies CD copies in the existing stock and location workflows. Public formats remain explicitly allowlisted, leaving CDs staff-only.
5. A staff-facing catalog provider module owns Discogs search, release retrieval, mapping, attribution links, and upstream error handling. Discogs credentials stay server-side.

The stock view should use a shared display projection for either a video title or a music release. A CD-specific add flow searches Discogs by artist/release title, shows candidate editions for staff confirmation, then attaches the copy. UPC/EAN lookup through Discogs is deferred; barcode scanning records the UPC/EAN on each physical copy only.

## Discogs API User-Agent

Use this server-side request header:

```http
User-Agent: VideoRewind/0.1.0
```

This identifies the application and uses the current package version (`0.1.0`). Keep the product token as `VideoRewind`; source the version from `package.json` so it can be updated without changing the provider code. No public site or repository URL is needed in the header. Send it from the server-side provider on every Discogs API request; never call the API directly from the browser. Do not use Discogs in the application name or imply Discogs endorsement. Discogs requires an identifying User-Agent; its official client documents `ExampleApplication/0.1` as a valid identifying string ([Discogs client quickstart](https://github.com/discogs/discogs_client/blob/master/docs/quickstart.md)).

## Track list and search data

Store only the information needed to render and search the track list:

- release foreign key
- display order and Discogs position
- entry kind (track or heading), title, and optional duration in seconds
- optional parent entry for nested/sub-track structures

Do not copy per-track credits, marketplace data, community statistics, or whole Discogs API responses. Search only actual track entries; retain headings and ordering so multi-disc and grouped listings display sensibly. Use a release-level full-text index for staff searches, and return the matching track with release title/artist and available copy/location information.

The distinct Discogs release is the deduplication boundary. Ten physical copies of one edition produce one release and one track list, not ten copies of every track.

### Approximate storage

Planning estimate, not a benchmark: assume 15 track entries per release and about 0.3–0.8 KB per stored/indexed track entry, including PostgreSQL row and index overhead. This excludes artwork and full API payloads.

| Distinct CD releases | Approximate track rows | Approximate track-list storage |
| -------------------: | ---------------------: | -----------------------------: |
|                1,000 |                 15,000 |                        5–12 MB |
|               10,000 |                150,000 |                      45–120 MB |
|               50,000 |                750,000 |                     225–600 MB |

This estimate covers only releases represented in our own catalog, not a full Discogs mirror. The expected app workload uses the API for staff-selected releases and stores the compact metadata/track list once per distinct pressing.

## Data source, attribution, and artwork

**Track and release metadata:** the project owner has confirmed with Discogs that CC0 data may be stored and displayed indefinitely when attribution is provided and a direct link to the Discogs entry is included. The six-hour freshness rule applies to explicit caching of API responses, not to normalized CC0 data used to hydrate our database. Fetch a specific release, persist the normalized CC0 metadata and compact track list for local search, and show “Data provided by Discogs” with a direct link on Discogs-backed release detail pages. Keep source release ID and URL with the record so attribution remains attached. Do not store user data, marketplace data, or other restricted fields. Discogs identifies release track listings, titles, dates, barcodes, and identifiers as CC0 in its [API Terms of Use](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use).

No six-hour synchronization job is planned. Routine track search and release pages use the stored snapshot indefinitely; a staff refresh can be considered later if useful. API request throttling still applies to upstream lookups and should be handled by the provider adapter.

**Artwork is permitted under Discogs' image terms, but is not CC0.** Follow those terms closely. Request/display album art only in the exact-edition confirmation and release detail views; do not persist it or fetch it for stock rows/search results. Allow browser caching for no more than six hours; avoid server, CDN, and image-optimizer caches. The confirmation view uses a non-persistent image route that fetches without upstream caching, sets a six-hour browser cache, and disables CDN caching. Show a generic CD placeholder everywhere else. If upstream rate limits become a problem, revisit caching with the user.

## Suggested implementation phases

1. **Domain and provider foundation:** create versioned migrations for Discogs and manual releases, ordered track entries, physical-copy links, uniqueness, and indexes. Add a server-only Discogs adapter for text search and exact release retrieval, with typed normalized results, timeouts, and response-aware throttling.
2. **Staff intake and release management:** search by artist/release title, show exact pressing candidates for staff confirmation, define the release sort title, capture the scanned UPC/EAN on the physical copy, then add the copy as the next step. If no exact match exists, allow staff to create a clearly marked manual release without Discogs identity or attribution.
3. **Persist release and track metadata:** store one normalized CC0 track list per specific Discogs release, including nested/multi-disc ordering. Keep Discogs release ID and direct URL; show attribution and link on the release detail page. Add staff-triggered refresh if useful, without a six-hour job.
4. **Release detail and track search:** render tracks and search locally, returning matching releases and physical copies with location and availability. Request artwork only on exact-edition confirmation and release detail views, do not persist it, and cap browser caching at six hours; use a generic CD image on stock/search/other pages.
5. **Stock integration and verification:** show CDs in staff stock and keep them out of public routes. Test exact-release deduplication, alternate pressings, nested tracks, search, Discogs errors/throttling, refresh reconciliation, artwork loading boundaries, and public isolation.

Keep CD work on `feature/discogs-cd-catalog`, branched from the dated release integration branch. The intake page mirrors title creation and is reached from the small CD link beside its heading. Before committing, run the focused server/database tests and the local verification gates required for the eventual release merge.

## Open decisions

- **Barcode lookup:** deferred. Capture a scanned UPC/EAN on each physical copy, without sending it to Discogs for lookup.
- **Missing year:** allow an unknown year, or use the same obvious placeholder convention as legacy video records?
- **Refresh controls:** decide whether staff-triggered refresh is useful, and what should happen if Discogs is unavailable during one.
- **Copy rules:** confirm whether CDs use the existing condition, rental price, location, and stock-history rules without CD-specific exceptions.

## Access-control dependency

CD pages and provider endpoints must remain in local development until staff authentication and server-side authorization exist. Hiding links in the staff menu does not protect routes or data. Add authorization checks to every CD read/write endpoint before exposing this workflow beyond the trusted local environment.

## References

- Discogs [API Terms of Use](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use)
- Discogs [Tracklisting Guidelines](https://support.discogs.com/hc/en-us/articles/360005055373-Database-Guidelines-12-Tracklisting)
- Discogs [Release Page Guide](https://support.discogs.com/hc/en-us/articles/17114733929229-Release-Page-Guide)
