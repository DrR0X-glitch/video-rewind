# Video Rewind Frontend

Next.js app for the Video Rewind public site and inventory UI. The app owns the `/api` routes directly and connects to PostgreSQL with `pg`.

## Development

### Parallel agent work

Use agents proactively when a task has independent, clearly bounded pieces that can safely proceed in parallel; no extra user instruction is needed. Give each agent an explicit scope, avoid overlapping edits to shared files, and review every agent's changes and verification before considering the task complete. Keep coordination and integration with the primary task owner.

1. Copy the example env file for the app and Docker Compose:

```bash
cp .env.example .env.local
cp .env.example .env
```

The Compose PostgreSQL service publishes on port `5432`.

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

3. Start PostgreSQL, apply migrations, and load the sample catalogue and inventory:

```bash
pnpm db:reset:dev
```

This is also the reset command. It clears catalogue and inventory records and reloads the development fixtures. Use it only when that reset is intended.

4. Start the app:

```bash
pnpm dev
```

Open `http://localhost:3000`.

`pnpm db:down` stops the Compose services while keeping the local database volume. To deliberately discard the local database and start fresh, run `docker compose down -v`, then repeat the setup steps.

### Existing local database

The normal migration command will not replay the baseline against a database that already has application tables. Back up and verify that it matches the current schema, then record the baseline without rerunning its SQL:

```bash
pnpm db:migrate:baseline
```

For future schema changes, add a new numbered SQL file under `db/migrations/` and run `pnpm db:migrate`. A migration may be revised while its branch is unmerged to `main`; reset and reseed affected local development databases so they apply the revised file from scratch. After merge, treat the migration as applied in production: never edit it, and add a new migration for later changes. Never reset a production database.

### Local database tests

There is one Compose PostgreSQL service for development. `pnpm db:reset:dev` validates and records the current baseline when it finds the existing schema without migration history; it applies the baseline SQL only to an empty database. It then reseeds the development fixtures. Database integration tests use the same local `dvd_store` database to check schema and seed state, create and remove a uniquely coded zone, and create and remove a uniquely named manual title. After preparing the database, run:

```bash
pnpm test:database
```

The database checks create and remove uniquely named test records; they leave the seeded fixture data intact. The explicit reset command replaces local catalogue and inventory data with fixtures, so do not use it if you need to keep local edits.

For LAN testing in production mode without dev websocket issues:

```bash
pnpm build
pnpm exec next start --hostname 0.0.0.0 --port 3000
```

For a containerized local deployment with Postgres:

```bash
docker compose up -d postgres
docker compose run --rm db-migrate
docker compose run --rm db-seed
docker compose up --build app
```

The app will be available on `http://localhost:3000`. Migrations and sample seeding are explicit local commands; the application container does not modify the database schema or seed records on startup. Compose credentials are for local development only.
Provide `TMDB_API_READ_ACCESS_TOKEN` and `OMDB_API_KEY` through your shell environment or a Compose `.env` file if you need TMDB/OMDb-backed title creation.

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

- `/`
- `/search`
- `/about`
- `/contact`
- `/movies/:id`
- `/inventory`
- `/inventory/cds`
- `/inventory/cds/releases/:id`
- `/inventory/:id`
- `/inventory/:id/edit`
- `/inventory/discs/:id`
- `/inventory/new`
- `/inventory/review`
- `/inventory/stock`
- `/inventory/stock/cds`

## API Routes

- `GET /api/health`
- `GET /api/movies`
- `GET /api/movies/:id`
- `PATCH /api/movies/:id`
- `DELETE /api/movies/:id`
- `POST /api/movies/bulk`
- `GET /api/tmdb/movie?url=...`
- `POST /api/inventory`
- `PATCH /api/inventory/:id`
- `PATCH /api/movies/:id/inventory`

## Notes

- PostgreSQL is managed locally with Docker Compose; ordered database migrations live in `db/migrations/`.
- The repo now includes a production [Dockerfile](/Users/zach/Coding/Clients/DVD/dvd-store/dvd-store-frontend/Dockerfile) using Next standalone output, plus an app service in [docker-compose.yml](/Users/zach/Coding/Clients/DVD/dvd-store/dvd-store-frontend/docker-compose.yml).
- For an existing local database without migration history, verify and back it up before running `pnpm db:migrate:baseline`.
- Local verification commands are `pnpm test` for server and browser unit tests, `pnpm test:database` for PostgreSQL integration checks, `pnpm lint` for ESLint, `pnpm typecheck` for TypeScript, `pnpm format:check` for formatting, and `pnpm build` for a production build. No CI pipeline is configured.
- Run `pnpm test:watch` while developing. Use `pnpm format` to apply the configured Prettier formatting.
- The app persists `sort_title`, `director`, `featured`, structured location fields, and `last_rented_at`.
- Title creation from TMDB also stores the TMDB-linked `imdb_id`, and if `OMDB_API_KEY` is configured it looks up and stores the IMDb rating for public display.
- TMDB collections are stored separately and only link to titles that already exist locally. Creating one title will not auto-create sibling titles.
- The `backfill:collections` script fills missing TMDB collection links for existing movie titles. CSV stock import does not currently create collection links during import.
- Inventory routes use a separate nav: `Homepage`, `Titles`, `Stock`, `Review`, `New`.
- Each disc gets a six-digit internal `inventory_code` when it is created. It identifies the copy inside the app and is not printed as a barcode.
- UPC/EAN is optional and stored per physical copy. Repeated codes are allowed; camera scanning is available where the browser supports it, with manual entry as fallback.
- New discs start as not reviewed, so they stay off the public site until staff review them.
- `/inventory/stock` now shows reviewed stock only.
- `/inventory/review` is the unreviewed queue, with shift-range selection, bulk mark-reviewed, bulk delete, per-row review actions, and sort grouped by Primary then Duplicate.
- `/inventory/stock` is a searchable, sortable table for reviewed movie/VHS stock with preset links for `All Discs` and `Wall`, visible filters including `Primary`, shift-range row selection, bulk edit/delete actions, pagination, and a `Show All` mode. CDs are excluded from the standard stock and review views and use the dedicated, no-art `/inventory/stock/cds` view with release and copy-specific fields.
- Primary/duplicate status is calculated automatically from highest format quality (`4K UHD`, `Blu-ray`, `DVD`) and then lowest `inventory_code`.
- The public homepage uses horizontal browse rows for featured titles, highest rated movies, popular movies, popular TV, recently returned, and top genres, with a compact search form in the intro panel.
- Titles can be marked `Hide from homepage` by staff to keep niche items such as concert recordings out of homepage rails without removing them from public search or detail pages.
- The public `/search` page is the full catalogue view with search, decade/genre/availability filters, and sort controls across title, genre, cast, director, and overview text.
- Public title pages include a back link and a compact per-copy table sorted by highest quality first.
- The public shell now includes a logo-style `Video Rewind` header mark and a minimal footer with a staff link to inventory.
- Search now uses PostgreSQL relevance ranking with title-first matches and lower-priority metadata fallback, instead of plain substring ordering.
- DB-backed pages are request-rendered in production so container/image builds do not require a live PostgreSQL connection.
- TMDB is authenticated using a TMDB API Read Access Token sent as a Bearer token, which matches TMDB's official application-auth docs: https://developer.themoviedb.org/docs/authentication-application and https://developer.themoviedb.org/reference/getting-started
