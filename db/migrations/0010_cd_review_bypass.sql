-- CD intake does not use the movie stock review workflow.
UPDATE inventory_items
SET reviewed = TRUE
WHERE format = 'cd' AND reviewed = FALSE;
