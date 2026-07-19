import Link from "next/link";

import { InventoryNewFlow } from "@/app/inventory/new/inventory-new-flow";
import { getMovieById, getSuggestedSortTitle, getTmdbMovieDraft } from "@/lib/data";
import { findDuplicateMovieForDraft } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type InventoryNewPageProps = {
  searchParams: Promise<{
    selected?: string;
    tmdb?: string;
    title?: string;
    sortTitle?: string;
  }>;
};

export default async function InventoryNewPage({
  searchParams,
}: InventoryNewPageProps) {
  const params = await searchParams;
  const selectedIds = (params.selected ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selectedMovies = await Promise.all(
    selectedIds.map((id) => getMovieById(id).catch(() => null)),
  ).then((items) => items.filter((item): item is NonNullable<(typeof items)[number]> => item !== null));
  const tmdbDraft =
    params.tmdb && params.tmdb.trim()
      ? await getTmdbMovieDraft(params.tmdb).catch(() => null)
      : null;
  const duplicateMovieId = tmdbDraft
    ? await findDuplicateMovieForDraft({
        tmdbId: tmdbDraft.tmdbId,
        mediaType: tmdbDraft.mediaType,
        title: tmdbDraft.title,
        releaseDate: tmdbDraft.releaseDate,
      }).catch(() => null)
    : null;
  const duplicateMovie =
    duplicateMovieId && !selectedIds.includes(duplicateMovieId)
      ? await getMovieById(duplicateMovieId).catch(() => null)
      : null;
  const title = params.title ?? tmdbDraft?.title ?? "The Thing";
  const suggestedSortTitle =
    params.sortTitle ?? tmdbDraft?.sortTitle ?? getSuggestedSortTitle(title);

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <h1>Find or create a title</h1>
        <p className="muted">Search first. If the title exists, add a copy to it. If not, create it from TMDB.</p>
      </section>

      <InventoryNewFlow
        key={`${params.selected ?? ""}|${params.tmdb ?? ""}|${title}|${suggestedSortTitle}`}
        initialSelectedMovies={selectedMovies}
        duplicateMovie={duplicateMovie}
        suggestedSortTitle={suggestedSortTitle}
        title={title}
        tmdbDraft={tmdbDraft}
        tmdbInput={params.tmdb ?? ""}
      />

      <p className="utility-row">
        <Link href="/inventory">Back to inventory</Link>
      </p>
    </div>
  );
}
