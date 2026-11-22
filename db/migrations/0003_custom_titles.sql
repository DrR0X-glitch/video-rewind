ALTER TABLE titles
  ALTER COLUMN tmdb_id DROP NOT NULL;

ALTER TABLE titles
  ADD COLUMN metadata_source TEXT NOT NULL DEFAULT 'tmdb'
    CHECK (metadata_source IN ('tmdb', 'manual'));

CREATE INDEX titles_normalized_name_type_release_date_idx
  ON titles (LOWER(BTRIM(title)), media_type, release_date);
