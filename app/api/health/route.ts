import { NextResponse } from "next/server";

import { checkDatabaseHealth } from "@/lib/server/store";
import { jsonError } from "@/lib/server/http";

export async function GET() {
  try {
    await checkDatabaseHealth();

    return NextResponse.json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    return jsonError(error);
  }
}
