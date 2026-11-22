CREATE TABLE IF NOT EXISTS inventory_zones (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_zones_code_not_empty CHECK (length(trim(code)) > 0),
  CONSTRAINT inventory_zones_label_not_empty CHECK (length(trim(label)) > 0)
);

INSERT INTO inventory_zones (code, label, sort_order)
VALUES
  ('S', 'Shed', 1),
  ('D', 'Display', 2),
  ('W', 'Wall', 3)
ON CONFLICT (code) DO NOTHING;

INSERT INTO inventory_zones (code, label, is_active)
SELECT DISTINCT zone, zone, FALSE
FROM inventory_items
WHERE length(trim(zone)) > 0
ON CONFLICT (code) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_items_zone_fkey'
      AND conrelid = 'inventory_items'::regclass
  ) THEN
    ALTER TABLE inventory_items
      ADD CONSTRAINT inventory_items_zone_fkey
      FOREIGN KEY (zone) REFERENCES inventory_zones(code)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inventory_zones_active_sort_idx
  ON inventory_zones (is_active, sort_order, code);
