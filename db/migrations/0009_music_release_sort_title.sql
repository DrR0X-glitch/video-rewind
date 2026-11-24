ALTER TABLE music_releases
  ADD COLUMN sort_title TEXT;

UPDATE music_releases
SET sort_title = COALESCE(NULLIF(BTRIM(regexp_replace(title, '^(a|an|the)[[:space:]]+', '', 'i')), ''), title);

ALTER TABLE music_releases
  ALTER COLUMN sort_title SET NOT NULL,
  ADD CONSTRAINT music_releases_sort_title_check
    CHECK (length(btrim(sort_title)) > 0);
