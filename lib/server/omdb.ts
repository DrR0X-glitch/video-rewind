import { createHttpError } from "@/lib/server/http";

type OmdbTitleResponse = {
  Response?: string;
  Error?: string;
  imdbID?: string;
  imdbRating?: string;
};

export type OmdbTitleMetadata = {
  imdbId: string;
  imdbRating: number | null;
};

function getOmdbApiKey() {
  return process.env.OMDB_API_KEY?.trim() ?? "";
}

export async function fetchOmdbTitleMetadataByImdbId(
  imdbId: string,
): Promise<OmdbTitleMetadata | null> {
  const apiKey = getOmdbApiKey();

  if (!apiKey || !/^tt\d+$/i.test(imdbId.trim())) {
    return null;
  }

  const response = await fetch(
    `https://www.omdbapi.com/?apikey=${encodeURIComponent(apiKey)}&i=${encodeURIComponent(imdbId.trim())}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw createHttpError(502, "OMDb request failed");
  }

  const payload = (await response.json()) as OmdbTitleResponse;

  if (payload.Response !== "True" || !payload.imdbID) {
    return null;
  }

  const imdbRating =
    typeof payload.imdbRating === "string" && payload.imdbRating !== "N/A"
      ? Number.parseFloat(payload.imdbRating)
      : null;

  return {
    imdbId: payload.imdbID.trim(),
    imdbRating: Number.isFinite(imdbRating) ? imdbRating : null,
  };
}
