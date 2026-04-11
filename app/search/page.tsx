import { PublicCatalogueClient } from "@/app/search/public-catalogue-client";
import { getBrowseFilters } from "@/lib/data";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<{
    available?: string;
    decade?: string;
    genre?: string;
    q?: string;
    sort?: string;
  }>;
};

const allowedSorts = new Set(["title", "rating-desc", "popular", "year-desc", "year-asc"]);
const decadeOptions = [
  { value: "2020", label: "20s" },
  { value: "2010", label: "10s" },
  { value: "2000", label: "00s" },
  { value: "1990", label: "90s" },
  { value: "1980", label: "80s" },
  { value: "1970", label: "70s" },
  { value: "1960", label: "60s" },
  { value: "1950", label: "50s" },
  { value: "pre-1950", label: "Pre-50s" },
];

function normalizeInitialDecade(value?: string) {
  if (!value) {
    return "all";
  }

  const normalizedValue = value.trim().toLowerCase();

  if (/^\d{4}$/.test(normalizedValue)) {
    return normalizedValue;
  }

  if (normalizedValue === "pre-1950") {
    return normalizedValue;
  }

  const shortMatch = normalizedValue.match(/^(\d{2})s$/);

  if (!shortMatch) {
    return "all";
  }

  const shortValue = Number.parseInt(shortMatch[1] ?? "", 10);

  if (Number.isNaN(shortValue)) {
    return "all";
  }

  return shortValue >= 30 ? `${1900 + shortValue}` : `${2000 + shortValue}`;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const filters = await getBrowseFilters();
  const genres = Array.isArray(filters?.genres) ? filters.genres : [];

  return (
    <PublicCatalogueClient
      decades={decadeOptions}
      genres={genres}
      initialAvailable={params.available === "true"}
      initialDecade={normalizeInitialDecade(params.decade)}
      initialGenre={params.genre ?? "all"}
      initialQuery={params.q?.trim() ?? ""}
      initialSort={allowedSorts.has(params.sort ?? "") ? params.sort ?? "title" : "title"}
    />
  );
}
