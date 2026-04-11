import { NextResponse } from "next/server";

import { ensureObject, jsonError } from "@/lib/server/http";
import { bulkUpdateMoviesInDatabase } from "@/lib/server/store";

export async function POST(request: Request) {
  try {
    const body = ensureObject(await request.json());
    const result = await bulkUpdateMoviesInDatabase(body);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
