import { NextResponse } from "next/server";

import {
  deleteMovieFromDatabase,
  getMovieFromDatabase,
  updateMovieInDatabase,
} from "@/lib/server/store";
import { ensureObject, jsonError } from "@/lib/server/http";

export async function GET(_request: Request, context: RouteContext<"/api/movies/[id]">) {
  try {
    const { id } = await context.params;
    const movie = await getMovieFromDatabase(id);
    return NextResponse.json(movie);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/movies/[id]">) {
  try {
    const { id } = await context.params;
    const body = ensureObject(await request.json());
    const result = await updateMovieInDatabase(id, body);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/movies/[id]">) {
  try {
    const { id } = await context.params;
    const result = await deleteMovieFromDatabase(id);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
