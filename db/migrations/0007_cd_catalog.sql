ALTER TYPE inventory_format ADD VALUE IF NOT EXISTS 'cd';

CREATE TABLE music_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discogs_release_id BIGINT NOT NULL UNIQUE CHECK (discogs_release_id > 0),
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  artist_credit TEXT NOT NULL DEFAULT '',
  release_year SMALLINT,
  country TEXT,
  label TEXT,
  catalog_number TEXT,
  discogs_url TEXT NOT NULL CHECK (length(btrim(discogs_url)) > 0),
  source_fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT music_releases_year_check CHECK (
    release_year IS NULL OR release_year BETWEEN 1 AND 9999
  )
);

CREATE TABLE music_release_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  music_release_id UUID NOT NULL REFERENCES music_releases(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  position TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  entry_type TEXT NOT NULL DEFAULT 'track'
    CHECK (entry_type IN ('track', 'heading')),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  parent_track_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT music_release_tracks_release_sequence_unique
    UNIQUE (music_release_id, sequence_no),
  CONSTRAINT music_release_tracks_release_id_unique
    UNIQUE (music_release_id, id),
  CONSTRAINT music_release_tracks_parent_same_release_fk
    FOREIGN KEY (music_release_id, parent_track_id)
    REFERENCES music_release_tracks (music_release_id, id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT music_release_tracks_parent_not_self_check
    CHECK (parent_track_id IS NULL OR parent_track_id <> id),
  CONSTRAINT music_release_tracks_heading_duration_check
    CHECK (entry_type <> 'heading' OR duration_seconds IS NULL)
);

CREATE TABLE inventory_item_music_releases (
  inventory_item_id UUID PRIMARY KEY REFERENCES inventory_items(id) ON DELETE CASCADE,
  music_release_id UUID NOT NULL REFERENCES music_releases(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX inventory_item_music_releases_release_id_idx
  ON inventory_item_music_releases (music_release_id);

CREATE INDEX music_release_tracks_title_search_idx
  ON music_release_tracks USING GIN (to_tsvector('simple'::regconfig, title))
  WHERE entry_type = 'track';

CREATE FUNCTION enforce_inventory_catalog_format() RETURNS TRIGGER AS $$
DECLARE
  linked_format TEXT;
BEGIN
  IF TG_TABLE_NAME = 'inventory_item_music_releases' THEN
    SELECT format::TEXT
    INTO linked_format
    FROM inventory_items
    WHERE id = NEW.inventory_item_id
    FOR UPDATE;

    IF linked_format IS DISTINCT FROM 'cd' THEN
      RAISE EXCEPTION 'Music releases can only be linked to CD inventory items.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM inventory_item_titles WHERE inventory_item_id = NEW.inventory_item_id
    ) THEN
      RAISE EXCEPTION 'CD inventory items cannot also link to video titles.';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'inventory_item_titles' THEN
    SELECT format::TEXT
    INTO linked_format
    FROM inventory_items
    WHERE id = NEW.inventory_item_id
    FOR UPDATE;

    IF linked_format = 'cd' OR EXISTS (
      SELECT 1
      FROM inventory_item_music_releases
      WHERE inventory_item_id = NEW.inventory_item_id
    ) THEN
      RAISE EXCEPTION 'Video titles can only be linked to non-CD inventory items.';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'inventory_items' THEN
    IF NEW.format::TEXT <> 'cd' AND EXISTS (
      SELECT 1
      FROM inventory_item_music_releases
      WHERE inventory_item_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'A CD item linked to a music release must remain in CD format.';
    END IF;

    IF NEW.format::TEXT = 'cd' AND EXISTS (
      SELECT 1 FROM inventory_item_titles WHERE inventory_item_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'An inventory item linked to video titles cannot change to CD format.';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unexpected trigger table: %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_item_music_releases_format_guard
  BEFORE INSERT OR UPDATE ON inventory_item_music_releases
  FOR EACH ROW EXECUTE FUNCTION enforce_inventory_catalog_format();

CREATE TRIGGER inventory_item_titles_format_guard
  BEFORE INSERT OR UPDATE ON inventory_item_titles
  FOR EACH ROW EXECUTE FUNCTION enforce_inventory_catalog_format();

CREATE TRIGGER inventory_items_catalog_format_guard
  BEFORE UPDATE OF format ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION enforce_inventory_catalog_format();
