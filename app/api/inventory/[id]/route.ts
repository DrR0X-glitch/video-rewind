import { NextResponse } from "next/server";

import { updateInventoryItemInDatabase } from "@/lib/server/inventory/items";
import { ensureObject, jsonError } from "@/lib/server/http";

export async function PATCH(request: Request, context: RouteContext<"/api/inventory/[id]">) {
  try {
    const { id } = await context.params;
    const payload = ensureObject(await request.json());
    const result = await updateInventoryItemInDatabase(id, payload);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
