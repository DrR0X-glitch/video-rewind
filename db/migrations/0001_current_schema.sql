CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'title_media_type') THEN
    CREATE TYPE title_media_type AS ENUM ('movie', 'series');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_format') THEN
    CREATE TYPE inventory_format AS ENUM ('dvd', 'blu-ray', '4k-uhd');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tmdb_id INTEGER NOT NULL,
  imdb_id TEXT,
  imdb_rating NUMERIC(3,1),
  media_type title_media_type NOT NULL,
  title TEXT NOT NULL,
  sort_title TEXT NOT NULL,
  overview TEXT NOT NULL DEFAULT '',
  release_date DATE,
  poster_path TEXT,
  genres TEXT[] NOT NULL DEFAULT '{}',
  director TEXT NOT NULL DEFAULT '',
  cast_members JSONB NOT NULL DEFAULT '[]'::jsonb,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  hide_from_homepage BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT titles_tmdb_unique UNIQUE (tmdb_id, media_type)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_code TEXT NOT NULL UNIQUE,
  availability BOOLEAN NOT NULL DEFAULT TRUE,
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  sealed BOOLEAN NOT NULL DEFAULT FALSE,
  format inventory_format NOT NULL,
  zone TEXT NOT NULL DEFAULT 'W',
  section TEXT NOT NULL DEFAULT '',
  row TEXT NOT NULL DEFAULT '',
  location_code TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  last_rented_at TIMESTAMPTZ,
  day_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  weekend_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  late_class INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS inventory_code TEXT;

ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS availability BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'inventory_items'
      AND column_name = 'reviewed'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN reviewed BOOLEAN;
    UPDATE inventory_items SET reviewed = TRUE WHERE reviewed IS NULL;
    ALTER TABLE inventory_items ALTER COLUMN reviewed SET DEFAULT FALSE;
    ALTER TABLE inventory_items ALTER COLUMN reviewed SET NOT NULL;
  END IF;
END $$;

ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS sealed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS location_code TEXT NOT NULL DEFAULT '';

ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS last_rented_at TIMESTAMPTZ;

ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS day_price NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS weekend_price NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS late_class INTEGER NOT NULL DEFAULT 0;

ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE SEQUENCE IF NOT EXISTS inventory_code_seq START 1;

ALTER TABLE inventory_items
ALTER COLUMN zone TYPE TEXT USING zone::text;

ALTER TABLE inventory_items
ALTER COLUMN row SET DEFAULT '';

DO $$
DECLARE
  max_code BIGINT;
BEGIN
  SELECT MAX(inventory_code::BIGINT)
  INTO max_code
  FROM inventory_items
  WHERE inventory_code ~ '^[0-9]{6}$';

  IF max_code IS NULL THEN
    PERFORM setval('inventory_code_seq', 1, FALSE);
  ELSE
    PERFORM setval('inventory_code_seq', max_code, TRUE);
  END IF;
END $$;

ALTER TABLE inventory_items
DROP COLUMN IF EXISTS barcode;

ALTER TABLE inventory_items
DROP COLUMN IF EXISTS location;

ALTER TABLE inventory_items
DROP COLUMN IF EXISTS last_returned_at;

ALTER TABLE inventory_items
DROP COLUMN IF EXISTS status;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'inventory_items'
      AND column_name = 'condition'
  ) THEN
    EXECUTE '
      UPDATE inventory_items
      SET sealed = CASE condition::text
        WHEN ''sealed'' THEN TRUE
        ELSE FALSE
      END
    ';

    EXECUTE 'ALTER TABLE inventory_items DROP COLUMN condition';
  END IF;
END $$;

DROP TYPE IF EXISTS inventory_condition;

UPDATE inventory_items
SET zone = CASE zone::text
  WHEN 'shed' THEN 'S'
  WHEN 'display' THEN 'D'
  WHEN 'wall' THEN 'W'
  ELSE zone::text
END;

UPDATE inventory_items
SET inventory_code = LPAD(COALESCE(NULLIF(REGEXP_REPLACE(inventory_code, '\D', '', 'g'), ''), nextval('inventory_code_seq')::text), 6, '0')
WHERE inventory_code IS NULL OR inventory_code !~ '^[0-9]{6}$';

UPDATE inventory_items
SET row = COALESCE(row, '');

UPDATE inventory_items
SET section = UPPER(LEFT(COALESCE(section, ''), 2)),
    row = UPPER(LEFT(COALESCE(row, ''), 2)),
    location_code = CONCAT(zone::text, '/', UPPER(LEFT(COALESCE(section, ''), 2)), UPPER(LEFT(COALESCE(row, ''), 2)));

ALTER TABLE inventory_items
ALTER COLUMN inventory_code SET NOT NULL;

ALTER TABLE inventory_items
ALTER COLUMN inventory_code DROP DEFAULT;

ALTER TABLE titles
ADD COLUMN IF NOT EXISTS imdb_id TEXT;

ALTER TABLE titles
ADD COLUMN IF NOT EXISTS imdb_rating NUMERIC(3,1);

ALTER TABLE titles
ADD COLUMN IF NOT EXISTS hide_from_homepage BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS inventory_item_titles (
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season_start INTEGER,
  season_end INTEGER,
  episode_start INTEGER,
  episode_end INTEGER,
  position INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT inventory_item_titles_season_range_check CHECK (
    season_end IS NULL OR (season_start IS NOT NULL AND season_end >= season_start)
  ),
  CONSTRAINT inventory_item_titles_episode_range_check CHECK (
    episode_end IS NULL OR (episode_start IS NOT NULL AND episode_end >= episode_start)
  ),
  PRIMARY KEY (inventory_item_id, title_id)
);

ALTER TABLE inventory_item_titles
ADD COLUMN IF NOT EXISTS season_start INTEGER;

ALTER TABLE inventory_item_titles
ADD COLUMN IF NOT EXISTS season_end INTEGER;

ALTER TABLE inventory_item_titles
ADD COLUMN IF NOT EXISTS episode_start INTEGER;

ALTER TABLE inventory_item_titles
ADD COLUMN IF NOT EXISTS episode_end INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_item_titles_season_range_check'
  ) THEN
    ALTER TABLE inventory_item_titles
    ADD CONSTRAINT inventory_item_titles_season_range_check CHECK (
      season_end IS NULL OR (season_start IS NOT NULL AND season_end >= season_start)
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_item_titles_episode_range_check'
  ) THEN
    ALTER TABLE inventory_item_titles
    ADD CONSTRAINT inventory_item_titles_episode_range_check CHECK (
      episode_end IS NULL OR (episode_start IS NOT NULL AND episode_end >= episode_start)
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tmdb_collection_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_name TEXT NOT NULL,
  anchor_title TEXT NOT NULL DEFAULT '',
  anchor_sort_title TEXT NOT NULL DEFAULT '',
  anchor_release_date DATE,
  overview TEXT NOT NULL DEFAULT '',
  poster_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collection_titles (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (collection_id, title_id)
);

ALTER TABLE collections
ADD COLUMN IF NOT EXISTS anchor_title TEXT NOT NULL DEFAULT '';

ALTER TABLE collections
ADD COLUMN IF NOT EXISTS anchor_sort_title TEXT NOT NULL DEFAULT '';

ALTER TABLE collections
ADD COLUMN IF NOT EXISTS anchor_release_date DATE;

CREATE INDEX IF NOT EXISTS titles_release_date_idx ON titles (release_date);
CREATE INDEX IF NOT EXISTS titles_sort_title_idx ON titles (sort_title);
CREATE INDEX IF NOT EXISTS titles_title_idx ON titles (title);
CREATE UNIQUE INDEX IF NOT EXISTS titles_imdb_id_unique_idx ON titles (imdb_id) WHERE imdb_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_items_availability_idx ON inventory_items (availability);
CREATE INDEX IF NOT EXISTS inventory_items_zone_section_row_idx ON inventory_items (zone, section, row);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_inventory_code_idx ON inventory_items (inventory_code);
CREATE INDEX IF NOT EXISTS inventory_item_titles_title_id_idx ON inventory_item_titles (title_id);
CREATE INDEX IF NOT EXISTS inventory_item_titles_inventory_item_id_idx ON inventory_item_titles (inventory_item_id);
CREATE INDEX IF NOT EXISTS collections_sort_name_idx ON collections (sort_name);
CREATE INDEX IF NOT EXISTS collections_anchor_sort_title_idx ON collections (anchor_sort_title);
CREATE INDEX IF NOT EXISTS collection_titles_title_id_idx ON collection_titles (title_id);
