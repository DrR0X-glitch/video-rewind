# Staff CD Catalog and Track Search

**Status:** Planning only. No CD implementation has started.

## Direction so far

- Keep CDs staff-managed and out of public catalogue pages.
- Use Discogs for selecting the exact CD release/pressing. Add the Discogs integration on a separate feature branch because the current title model is TMDB-specific.
- Store the selected Discogs release once, then link each physical inventory copy to it. Copies of the same Discogs release share one metadata row and one track list.
- Store a compact track list locally so staff can search for a song across the collection and list tracks on a release page.
- Treat the existing `inventory_items` record as the physical copy: its UPC/EAN, location, availability, condition, price, and stock history remain per copy.

## Fit with the current architecture

The existing `titles` table and `inventory_item_titles` relationship represent TMDB movies and series. Their identifiers, media types, collection queries, and public pages assume video. Adding album fields and Discogs identifiers to that table would spread music-specific behavior through those paths.

Add a separate music catalog domain instead:

1. `music_releases` represents a specific Discogs release ID, not only the broader master album. Different pressings can have different barcodes or track listings, so they remain distinct records.
2. `music_release_tracks` stores ordered track entries once per release.
3. `inventory_item_music_releases` links a physical CD copy to its selected release. Multiple copies can point to the same release.
4. `inventory_items.format = 'cd'` identifies CD copies in the existing stock and location workflows. Public formats remain explicitly allowlisted, leaving CDs staff-only.
5. A staff-facing catalog provider module owns Discogs search, release retrieval, mapping, attribution links, and upstream error handling. Discogs credentials stay server-side.

The stock view should use a shared display projection for either a video title or a music release. A CD-specific add flow can search by barcode, artist/title, or Discogs release ID, show candidate editions for staff confirmation, then attach the copy. Existing per-copy UPC/EAN capture remains the inventory barcode field.

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

Storage is modest at a local rental collection scale. The harder part is keeping the stored Discogs data current while respecting API freshness, caching, and rate-limit rules.

## Refresh and Discogs data rules

Discogs classifies track listings as CC0 data, but its API terms also say content may not be displayed when it is more than six hours older than Discogs and may not be cached/stored longer than needed for the app. The terms require “Data provided by Discogs” attribution next to API data with a link to the matching Discogs page. Check the current [API Terms of Use](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use) again before implementation.

Before coding track search, choose and test a freshness strategy that covers both release pages and search results. A local index that is refreshed only when an individual release page is opened can miss newly added tracks elsewhere in the collection. A scheduled or queued refresh needs bounded concurrency, response-header-aware throttling, retry/backoff, and a clear stale-data behavior when Discogs is unavailable. Do not display expired track data as current.

Discogs release images have separate usage conditions from track metadata. Do not persist or display Discogs cover art until its use for this staff rental catalog has been checked. The stock view can show a neutral no-art tile in the meantime.

## Suggested implementation phases

1. **Confirm model and provider contract:** decide required release metadata, manual fallback when no Discogs match exists, cover-art behavior, refresh cadence, and what staff sees when the provider is down.
2. **Create the music catalog domain:** versioned migrations for releases, track entries, inventory links, uniqueness, indexes, and format constraints. Add server-only Discogs search/release services with explicit timeouts and rate-limit handling.
3. **Add staff CD intake and editing:** search/select the exact release, capture the copy UPC/EAN, assign location and pricing, and allow moving a copy to another release if staff chose the wrong pressing.
4. **Add release detail and track search:** show the locally stored ordered track list with Discogs attribution; search tracks and show matching releases plus copy availability and locations.
5. **Harden and verify:** exercise duplicate physical copies, alternate pressings, nested/multi-disc tracks, failed/stale upstream requests, migration forward-application, and proof that public browse/detail APIs never return CD-only records.

Keep this work on a separate `feature/discogs-cd-catalog` branch after the current VHS/stock-art branch is reviewed. Do not start CD coding until the phase-one decisions are settled.

## Open decisions

- Which local release fields should staff use for identification and filing: artist, title, year, label, catalog number, genre/style, and Discogs URL?
- If Discogs has no matching CD, should staff be able to create a manual music release, or should the item wait for a Discogs record?
- Should a UPC scan search Discogs by barcode first and still require staff to confirm the pressing?
- What refresh schedule can keep the stored track index current at the expected catalog size, and what should staff see when refresh is delayed or Discogs is unavailable?
- Is Discogs cover art permitted for this rental-only staff application, or should CD stock use no-art placeholders until separately sourced artwork is available?
- Which CD-specific fields (if any) differ from video-copy condition, rental pricing, and location handling?

## References

- Discogs [API Terms of Use](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use)
- Discogs [Tracklisting Guidelines](https://support.discogs.com/hc/en-us/articles/360005055373-Database-Guidelines-12-Tracklisting)
- Discogs [Release Page Guide](https://support.discogs.com/hc/en-us/articles/17114733929229-Release-Page-Guide)
