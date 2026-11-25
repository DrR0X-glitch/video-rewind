ALTER TABLE titles
ADD COLUMN IF NOT EXISTS release_year SMALLINT;

UPDATE titles
SET release_year = EXTRACT(YEAR FROM release_date)::SMALLINT
WHERE release_year IS NULL
  AND release_date IS NOT NULL;

UPDATE titles
SET release_date = DATE '0001-01-01',
    release_year = 1
WHERE release_year IS NULL
  AND release_date IS NULL;

UPDATE titles
SET sort_title = title
WHERE length(trim(sort_title)) = 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM titles WHERE length(trim(sort_title)) = 0) THEN
    RAISE EXCEPTION 'Cannot require sort titles until every existing title has a non-empty sort title.';
  END IF;
END $$;

ALTER TABLE titles
ALTER COLUMN release_year SET NOT NULL;

ALTER TABLE titles
ADD CONSTRAINT titles_release_year_range_check
CHECK (release_year BETWEEN 1 AND 9999);

ALTER TABLE titles
ADD CONSTRAINT titles_sort_title_non_empty_check
CHECK (length(trim(sort_title)) > 0);

ALTER TABLE titles
ADD CONSTRAINT titles_release_date_year_matches_check
CHECK (release_date IS NULL OR EXTRACT(YEAR FROM release_date)::INTEGER = release_year);

CREATE INDEX IF NOT EXISTS titles_release_year_idx ON titles (release_year);
