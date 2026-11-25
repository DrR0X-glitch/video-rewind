import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { searchInventoryTitlesPage } from "@/lib/data";
import { createInventoryItemInDatabase } from "@/lib/server/inventory/items";
import { ensureObject, jsonError, parseInteger } from "@/lib/server/http";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("search")?.trim() || undefined;
    const page = parseInteger(request.nextUrl.searchParams.get("page"), "page") ?? undefined;
    const pageSize =
      parseInteger(request.nextUrl.searchParams.get("pageSize"), "pageSize") ?? undefined;
    const results = await searchInventoryTitlesPage(query, page, pageSize);
    return NextResponse.json(results);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = ensureObject(await request.json());
    const result = await createInventoryItemInDatabase(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
