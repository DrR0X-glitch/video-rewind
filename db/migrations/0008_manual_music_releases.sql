ALTER TABLE music_releases
  ADD COLUMN source TEXT NOT NULL DEFAULT 'discogs'
    CHECK (source IN ('discogs', 'manual'));

ALTER TABLE music_releases
  ALTER COLUMN discogs_release_id DROP NOT NULL,
  ALTER COLUMN discogs_url DROP NOT NULL,
  ALTER COLUMN source_fetched_at DROP NOT NULL;

ALTER TABLE music_releases
  ADD CONSTRAINT music_releases_source_identity_check
  CHECK (
    (
      source = 'discogs'
      AND discogs_release_id IS NOT NULL
      AND discogs_url IS NOT NULL
      AND source_fetched_at IS NOT NULL
    )
    OR (
      source = 'manual'
      AND discogs_release_id IS NULL
      AND discogs_url IS NULL
      AND source_fetched_at IS NULL
    )
  );
