import { NextResponse } from "next/server";

import { bulkUpdateMovieInventoryInDatabase } from "@/lib/server/store";
import { ensureObject, jsonError } from "@/lib/server/http";

export async function PATCH(request: Request, context: RouteContext<"/api/movies/[id]/inventory">) {
  try {
    const { id } = await context.params;
    const payload = ensureObject(await request.json());
    const result = await bulkUpdateMovieInventoryInDatabase(id, payload);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
