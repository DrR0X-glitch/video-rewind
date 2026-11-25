ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS upc_ean TEXT;

CREATE INDEX IF NOT EXISTS inventory_items_upc_ean_idx
ON inventory_items (upc_ean)
WHERE upc_ean IS NOT NULL;
