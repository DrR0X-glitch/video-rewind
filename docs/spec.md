# Video Rewind App Spec

## Purpose

Staff-first catalogue and inventory app for physical discs. The Next app owns both UI and API routes. Titles can be movies or TV series, and one disc can contain multiple titles.

## Routes

- `/` Public browse homepage with row-based discovery and direct search submit
- `/search` Full public catalogue search/filter/sort page
- `/about` Public brand/about page
- `/contact` Static public contact page
- `/movies/[id]` Read-only title detail
- `/inventory` Inventory title search and bulk title actions
- `/inventory/[id]` Title-level inventory detail
- `/inventory/new` Add disc flow
- `/inventory/review` Review queue for unreviewed discs
- `/inventory/[id]/edit` Edit title metadata
- `/inventory/discs/[id]` Disc edit screen
- `/inventory/stock` Searchable and sortable disc stock view

## Product Rules

- Inventory lives at a separate URL and is not publicly linked from the public site.
- No auth in v1.
- Homepage is for browsing titles, not admin work.
- Bulk title actions and bulk stock updates are supported.
- Public pages only show titles that have at least one reviewed disc.
- Staff can hide individual titles from homepage discovery rows without removing them from public search or public detail pages.
- DB-backed pages are rendered at request time in production rather than depending on build-time database access.

## Home

Purpose: browse the catalogue quickly through row-based discovery.

Sections:

- Intro panel with search form that submits to `/search?q=...`
- Featured row
- Highest rated movies row
- Popular movies row
- Popular TV row
- Recently returned titles
- Top genre rows
- Link through via nav to the full catalogue page for filtering/searching

## Public Detail

Purpose: read-only title view.

Include:

- Title
- Media type (`movie` or `series`)
- Sort title
- Overview
- Release/first-air year; the exact date is optional
- Poster
- Genres
- Director/creator
- Cast
- Collection siblings for movies that belong to a TMDB collection
- Derived `available_count`
- Derived `total_copies`
- Compact public per-copy table sorted by highest quality first (`4k-uhd`, `blu-ray`, `dvd`)
- Back link to the catalogue/search flow

No inventory editing on the public detail page.

## Public Search

Purpose: full public catalogue page.

Include:

- search across title, sort title, genre, cast, director, and overview text
- title and sort-title matches rank above metadata matches
- filter controls for genre, decade, and availability
- sort controls for alphabetical, highest rated, popular, newest, and oldest
- result cards linking to the public title detail page
- derived result count

## Inventory Area

Purpose: search titles quickly and manage physical copies.

At minimum:

- Search by title
- View title-level stock counts
- Select a title to inspect all discs that include it
- Edit a title
- Delete a title only when no discs are linked
- Add a new disc
- Apply bulk title actions from the title list
- Open and edit a disc record directly
- Record an optional UPC/EAN barcode on each physical disc copy, using camera scanning where supported or manual entry
- View stock in a searchable disc table

Inventory title detail should show:

- Title summary
- Derived `available_count`
- Derived `total_copies`
- All related discs
- The full set of titles on each disc, because a single disc may contain multiple titles
- Title management actions

## Stock View

Purpose: inspect and update physical stock by disc, not by title rows.

Current stock view:

- reviewed discs only
- preset links for `all` and `wall`
- free-text search across disc code, UUID, location code, notes, and linked title names
- search ranking prioritizes disc code and title matches above location or notes
- filters for availability, last edited, primary/duplicate, plus multi-select format, sealed state, and zone
- a merged titles column that shows linked titles with years and any linked series season or episode range, plus collection-order context when relevant
- sortable controls for disc code, format, primary/duplicate, collection order, availability, sealed, last edited, and location
- all secondary sorting falls back to sort title within the chosen grouping
- paginated results at 50 discs per page, with a visible shown-range count
- optional `Show All` mode in pagination
- shift-range checkbox selection within the current page
- bulk edit for availability and location fields, plus bulk deletion
- per-row disc editing action

Wall preset:

- zone = `Wall`
- primary filter = `Primary`
- sorted by `Location`

Notes:

- this view is disc-based, so box sets and multi-title discs appear as one row
- collection ordering anchors a disc against the first locally linked collection title when relevant

## Review Queue

Purpose: approve newly added stock before it appears on the public site.

Current review queue:

- shows unreviewed discs only
- no pagination, one long table
- supports shift-range checkbox selection
- supports bulk mark-reviewed
- supports bulk delete
- supports per-row review from the table
- sorted by `Primary` first, then `Duplicate`, with descending disc codes inside each group
- links through to disc edit when deeper inspection is needed

## Add Disc Flow

1. Search for existing titles first.
2. Staff can add one or more existing titles to the disc.
3. If a needed title does not exist, resolve it from TMDB.
4. TMDB links may be for movies or TV series.
5. Before creating a title, the app checks whether that TMDB title already exists locally.
6. If it already exists, staff must use the existing title instead of creating a duplicate.
7. If it does not exist, staff creates the title, sets `sort_title`, and the new title becomes selected for disc creation.
8. A disc starts with boolean `availability`, defaulting to `true`.
9. A disc starts with boolean `reviewed`, defaulting to `false`, and unreviewed discs do not appear on the public site.
10. A disc receives a six-digit internal `inventory_code` when it is created.
11. Staff can record a UPC/EAN barcode on the physical disc copy. Values are optional and may repeat across copies.
12. When a disc links to a TV series title, staff records a contiguous season span for that disc-title link, such as `Season 7` or `Seasons 1-3`.
13. When a disc only contains part of a single season, staff can also record a contiguous episode span such as `Episodes 1-3`.

## Data Model

### Titles

Shared metadata for either a movie or a TV series.

Fields:

- `id`
- `tmdb_id`
- `imdb_id`
- `imdb_rating`
- `media_type` (`movie`, `series`)
- `title`
- `sort_title`
- `release_year` (required four digit year used for decade filtering)
- `overview`
- `release_date` (optional exact date; its year must match `release_year`)
- `poster_path`
- `genres`
- `director`
- `cast_members`
- `featured`
- `hide_from_homepage`
- `created_at`
- `updated_at`

Notes:

- `sort_title` exists because filing may ignore leading articles.
- `title`, `sort_title`, and `release_year` are required for manual and TMDB-backed title entry. When a source only provides a year, the app does not invent a month or day.
- `director` stores the director for movies and the creator label for series in the current UI.
- `imdb_id` is captured from TMDB external ids when a title is created from the TMDB lookup flow.
- `imdb_rating` is populated from OMDb when an IMDb id is available and the OMDb API key is configured.
- Existing rows can be backfilled without overwriting populated metadata via the IMDb backfill script.
- Missing TMDB collection links can be backfilled for existing movies via the collections backfill script.

### Collections

TMDB movie collections are stored separately from inventory packaging.

Fields:

- `id`
- `tmdb_collection_id`
- `name`
- `sort_name`
- `overview`
- `poster_path`
- `created_at`
- `updated_at`

### Collection Titles

Join table linking movie titles to a TMDB collection in order.

Fields:

- `collection_id`
- `title_id`
- `position`

Notes:

- Collections are for film navigation, not for editorial/manual groups.
- Only movie titles belong to TMDB collections.
- Creating a movie from TMDB stores the collection metadata but does not auto-create sibling titles.
- Collection navigation only shows sibling films that already exist locally.
- CSV stock import does not currently create TMDB collection links during import; use the collection backfill script afterward if needed.

### Inventory Items

One row per physical disc or disc package.

Fields:

- `id`
- `inventory_code` required six-digit internal code
- `upc_ean` optional UPC/EAN stored on this physical copy; duplicates allowed
- `availability` boolean
- `reviewed` boolean
- `sealed` boolean
- `format` (`dvd`, `blu-ray`, `4k-uhd`)
- `zone` (`S`, `D`, `W`) rendered as Shed / Display / Wall
- `section`
- `row` optional
- `location_code`
- `notes`
- `last_rented_at` optional
- `day_price`
- `weekend_price`
- `late_class`
- `created_at`
- `updated_at`

### Inventory Item Titles

Join table linking discs to one or more titles.

Fields:

- `inventory_item_id`
- `title_id`
- `season_start` optional integer
- `season_end` optional integer
- `episode_start` optional integer
- `episode_end` optional integer
- `position`

This enables:

- single-title discs
- movie double features
- box sets that contain multiple related titles

## Collections vs Discs

Collections and discs are intentionally separate:

- A TMDB collection says which films belong together canonically.
- An inventory item says which titles are physically contained in one owned package.

Example:

- A `Die Hard Collection` row can exist even if no discs are owned.
- One boxed set disc can still link to all owned `Die Hard` films through `inventory_item_titles`.

## Barcode Labels

- Inventory codes are allocated when a disc is created.
- Inventory codes are six-digit numeric strings such as `000001`.
- Label workflows print the existing inventory code; they do not mint a new code.
- The internal inventory code identifies the exact copy for rentals, returns, and damage tracking.

## Primary Disc Status

Primary/duplicate status is calculated automatically per disc from linked-title data.

Rules:

- highest format quality wins (`4k-uhd`, then `blu-ray`, then `dvd`)
- ties break on lowest `inventory_code`
- a disc is shown as `Primary` if it is the best-ranked copy for any linked title
- otherwise it is shown as `Duplicate`

This status is not stored manually.

## Inventory Principle

Each physical disc is its own inventory record.

- One title -> many inventory items
- One inventory item -> one or many titles
- Availability is derived, never stored manually

Derived fields:

- `available_count = COUNT(DISTINCT inventory_items WHERE availability = TRUE)`
- `total_copies = COUNT(DISTINCT all inventory_items linked to the title)`

## Location Encoding

Location is structured, not freeform.

Required:

- `zone`
- `section`

Optional:

- `row`

Examples:

- Wall filing: `zone=wall`, `section=M`, `row=3`
- Archive box: `zone=shed`, `section=Box 12`, `row=8`

## API Shape

Base URL:

```txt
/api
```

### `GET /movies`

Returns title browse results with:

- title metadata needed for cards/detail links
- `available_count`
- `total_copies`

Supports optional query params:

- `search`
- `genre`
- `year`
- `available`

### `GET /movies/:id`

Returns one title with:

- title metadata
- related discs
- `available_count`
- `total_copies`

### `POST /movies`

Creates a new title after TMDB resolution and duplicate checking.

### `PATCH /movies/:id`

Updates editable title metadata such as title, sort title, media type, overview, release year, optional exact release date, genres, cast, director, featured, and hide-from-homepage.

### `DELETE /movies/:id`

Deletes a title only if no discs are still linked to it.

### `POST /movies/bulk`

Applies bulk title actions. Current actions:

- `feature`
- `unfeature`
- `delete`

### `POST /inventory`

Creates a new disc and links it to one or more titles.

### `PATCH /inventory/:id`

Updates a disc’s editable fields such as availability, sealed state, location, or notes.

## Styling Direction

- Nostalgic and retro-leaning, not a full 90s parody
- Sparse UI
- Hard edges
- Minimal surfaces
- No bloated component styling
- Dark mode supports both system preference and manual toggle

## Deferred

- Auth for inventory area
- Rental history and returns system
- LED shelf mapping
