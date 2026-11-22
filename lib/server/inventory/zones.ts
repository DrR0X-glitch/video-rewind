import "server-only";

import {
  parseInventoryZoneCode,
  parseInventoryZoneIdentifier,
  parseInventoryZoneLabel,
} from "@/lib/inventory-zones";
import { pool } from "@/lib/server/db";
import { createHttpError } from "@/lib/server/http";
import type { InventoryZone } from "@/lib/inventory-zones";

type InventoryZoneRow = {
  code: string;
  label: string;
  is_active: boolean;
};

function toInventoryZone(row: InventoryZoneRow): InventoryZone {
  return { code: row.code, label: row.label, isActive: row.is_active };
}

export async function listInventoryZones(options?: {
  activeOnly?: boolean;
  includeCode?: string;
}): Promise<InventoryZone[]> {
  const result = await pool.query<InventoryZoneRow>(
    `
      SELECT code, label, is_active
      FROM inventory_zones
      WHERE ($1::boolean = FALSE OR is_active = TRUE OR code = $2)
      ORDER BY sort_order ASC, code ASC;
    `,
    [options?.activeOnly ?? false, options?.includeCode ?? null],
  );

  return result.rows.map(toInventoryZone);
}

export async function assertInventoryZoneIsAssignable(code: string, inventoryItemId?: string) {
  const result = await pool.query<{ is_active: boolean }>(
    `SELECT is_active FROM inventory_zones WHERE code = $1`,
    [code],
  );
  const zone = result.rows[0];

  if (!zone) {
    throw createHttpError(400, 'Field "zone" is invalid');
  }
  if (zone.is_active) {
    return;
  }

  if (inventoryItemId) {
    const currentItem = await pool.query<{ zone: string }>(
      `SELECT zone FROM inventory_items WHERE id = $1`,
      [inventoryItemId],
    );
    if (currentItem.rows[0]?.zone === code) {
      return;
    }
  }

  throw createHttpError(400, 'Field "zone" is inactive');
}

export async function createInventoryZone(input: { code: unknown; label: unknown }) {
  const code = parseInventoryZoneCode(input.code);
  const label = parseInventoryZoneLabel(input.label);

  if (!code) {
    throw createHttpError(400, "Zone code must be 1 to 4 letters or numbers.");
  }
  if (!label) {
    throw createHttpError(400, "Zone name must be between 1 and 40 characters.");
  }

  try {
    const result = await pool.query<InventoryZoneRow>(
      `
        INSERT INTO inventory_zones (code, label)
        VALUES ($1, $2)
        RETURNING code, label, is_active;
      `,
      [code, label],
    );
    return toInventoryZone(result.rows[0]!);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw createHttpError(409, `Zone code ${code} already exists.`);
    }
    throw error;
  }
}

export async function renameInventoryZone(codeValue: unknown, labelValue: unknown) {
  const code = parseInventoryZoneIdentifier(codeValue);
  const label = parseInventoryZoneLabel(labelValue);
  if (!code) {
    throw createHttpError(400, "Zone code is invalid.");
  }
  if (!label) {
    throw createHttpError(400, "Zone name must be between 1 and 40 characters.");
  }

  const result = await pool.query<InventoryZoneRow>(
    `
      UPDATE inventory_zones
      SET label = $2, updated_at = NOW()
      WHERE code = $1
      RETURNING code, label, is_active;
    `,
    [code, label],
  );
  if (!result.rows[0]) {
    throw createHttpError(404, "Zone not found.");
  }
  return toInventoryZone(result.rows[0]);
}

export async function setInventoryZoneActive(codeValue: unknown, isActive: boolean) {
  const code = parseInventoryZoneIdentifier(codeValue);
  if (!code) {
    throw createHttpError(400, "Zone code is invalid.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const allZones = await client.query<InventoryZoneRow>(
      `SELECT code, label, is_active FROM inventory_zones ORDER BY code FOR UPDATE`,
    );
    const existing = allZones.rows.find((zone) => zone.code === code);
    if (!existing) {
      throw createHttpError(404, "Zone not found.");
    }
    if (
      !isActive &&
      existing.is_active &&
      allZones.rows.filter((zone) => zone.is_active).length <= 1
    ) {
      throw createHttpError(409, "At least one zone must remain active.");
    }

    const result = await client.query<InventoryZoneRow>(
      `
        UPDATE inventory_zones
        SET is_active = $2, updated_at = NOW()
        WHERE code = $1
        RETURNING code, label, is_active;
      `,
      [code, isActive],
    );
    await client.query("COMMIT");
    return toInventoryZone(result.rows[0]!);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
