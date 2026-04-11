# Video Rewind Frontend

Next.js app for the Video Rewind public site and inventory UI. The app owns the `/api` routes directly and connects to PostgreSQL with `pg`.

## Development

1. Copy envs in this frontend app:

```bash
cp .env.example .env.local
```

Add your TMDB read token to `.env.local`:

```bash
TMDB_API_READ_ACCESS_TOKEN=your_tmdb_read_access_token
OMDB_API_KEY=your_omdb_api_key
```

For PostgreSQL you can either use one connection string:

```bash
DATABASE_URL=postgres://user:password@localhost:5432/dbname
```

or discrete variables:

```bash
PGHOST=localhost
PGPORT=5432
PGUSER=user
PGPASSWORD=password
PGDATABASE=dbname
```

2. Install dependencies:

```bash
pnpm install
```

3. Start PostgreSQL:

```bash
pnpm db:up
```

4. Initialize the schema and run the app:

```bash
pnpm db:init
pnpm dev
```

Open `http://localhost:3000`.

For LAN testing in production mode without dev websocket issues:

```bash
pnpm build
pnpm exec next start --hostname 0.0.0.0 --port 3000
```

For a containerized local deployment with Postgres:

```bash
docker compose up --build
```

The app will be available on `http://localhost:3000` and will initialize the database schema on container start.
Provide `TMDB_API_READ_ACCESS_TOKEN` and `OMDB_API_KEY` through your shell environment or a Compose `.env` file before building if you need TMDB/OMDb-backed title creation.

To backfill missing IMDb ids and ratings on existing titles:

```bash
pnpm backfill:imdb
```

This only fills missing `imdb_id` / `imdb_rating` values and does not overwrite existing data.
It prints running progress as `[current/total] Title`.
For per-title lookup detail, run:

```bash
pnpm backfill:imdb -- --verbose
```

To backfill missing TMDB collection links on existing movie titles:

```bash
pnpm backfill:collections
```

For per-title detail, run:

```bash
pnpm backfill:collections -- --verbose
```

To import stock from a CSV file:

```bash
pnpm import:stock -- ./path/to/stock.csv
```

This reads only `TMDB`, `Wall`, `Section`, `Format`, `Copies`, `Sealed`, and `Notes`, creates any missing TMDB titles, then creates that many unreviewed disc entries.
It does not currently backfill TMDB collection links by itself.
For per-row detail, run:

```bash
pnpm import:stock -- ./path/to/stock.csv --verbose
```

## App Routes

* `/`
* `/search`
* `/about`
* `/contact`
* `/movies/:id`
* `/inventory`
* `/inventory/:id`
* `/inventory/:id/edit`
* `/inventory/discs/:id`
* `/inventory/discs/:id/label`
* `/inventory/new`
* `/inventory/review`
* `/inventory/stock`

## API Routes

* `GET /api/health`
* `GET /api/movies`
* `GET /api/movies/:id`
* `PATCH /api/movies/:id`
* `DELETE /api/movies/:id`
* `POST /api/movies/bulk`
* `GET /api/tmdb/movie?url=...`
* `POST /api/inventory`
* `PATCH /api/inventory/:id`
* `PATCH /api/movies/:id/inventory`

## Notes

* PostgreSQL is fully managed from this repo via [docker-compose.yml](/Users/zach/Coding/Clients/DVD/dvd-store/dvd-store-frontend/docker-compose.yml) and [db/schema.sql](/Users/zach/Coding/Clients/DVD/dvd-store/dvd-store-frontend/db/schema.sql).
* The repo now includes a production [Dockerfile](/Users/zach/Coding/Clients/DVD/dvd-store/dvd-store-frontend/Dockerfile) using Next standalone output, plus an app service in [docker-compose.yml](/Users/zach/Coding/Clients/DVD/dvd-store/dvd-store-frontend/docker-compose.yml).
* For an existing database, run `pnpm db:init` after schema changes.
* Verification for this repo is `pnpm lint` and `pnpm build`.
* The app persists `sort_title`, `director`, `featured`, structured location fields, and `last_rented_at`.
* Title creation from TMDB also stores the TMDB-linked `imdb_id`, and if `OMDB_API_KEY` is configured it looks up and stores the IMDb rating for public display.
* TMDB collections are stored separately and only link to titles that already exist locally. Creating one title will not auto-create sibling titles.
* The `backfill:collections` script fills missing TMDB collection links for existing movie titles. CSV stock import does not currently create collection links during import.
* Inventory routes use a separate nav: `Homepage`, `Titles`, `Stock`, `Review`, `New`.
* Each disc gets a six-digit internal `inventory_code` when it is created. Label workflows print that existing code; they do not allocate a new one later.
* New discs start as not reviewed, so they stay off the public site until staff review them.
* `/inventory/stock` now shows reviewed stock only.
* `/inventory/review` is the unreviewed queue, with shift-range selection, bulk mark-reviewed, bulk delete, per-row review actions, and sort grouped by Primary then Duplicate.
* Barcode labels are rendered as Code 128 SVG and can be printed from disc and stock workflows.
* The stock view is a searchable, sortable disc table for reviewed stock with preset links for `All Discs` and `Wall`, visible filters including `Primary`, shift-range row selection, bulk edit/delete actions, pagination, and a `Show All` mode.
* Primary/duplicate status is calculated automatically from highest format quality (`4K UHD`, `Blu-ray`, `DVD`) and then lowest `inventory_code`.
* The public homepage uses horizontal browse rows for featured titles, highest rated movies, popular movies, popular TV, recently returned, and top genres, with a compact search form in the intro panel.
* Titles can be marked `Hide from homepage` by staff to keep niche items such as concert recordings out of homepage rails without removing them from public search or detail pages.
* The public `/search` page is the full catalogue view with search, decade/genre/availability filters, and sort controls across title, genre, cast, director, and overview text.
* Public title pages include a back link and a compact per-copy table sorted by highest quality first.
* The public shell now includes a logo-style `Video Rewind` header mark and a minimal footer with a staff link to inventory.
* Search now uses PostgreSQL relevance ranking with title-first matches and lower-priority metadata fallback, instead of plain substring ordering.
* DB-backed pages are request-rendered in production so container/image builds do not require a live PostgreSQL connection.
* TMDB is authenticated using a TMDB API Read Access Token sent as a Bearer token, which matches TMDB's official application-auth docs: https://developer.themoviedb.org/docs/authentication-application and https://developer.themoviedb.org/reference/getting-started
