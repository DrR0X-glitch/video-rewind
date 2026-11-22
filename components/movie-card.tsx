import Image from "next/image";
import Link from "next/link";

import { formatMediaType, formatReleaseYear, getAvailabilityLabel } from "@/lib/format";
import type { MovieWithInventory } from "@/lib/types";
import { PosterSwatch } from "@/components/poster-swatch";

export function MovieCard({
  movie,
  variant = "default",
}: {
  movie: MovieWithInventory;
  variant?: "default" | "rail";
}) {
  const isRail = variant === "rail";
  const imageSizes = isRail
    ? "(max-width: 700px) 138px, (max-width: 960px) 146px, 156px"
    : "(max-width: 768px) 50vw, 180px";

  return (
    <article className={isRail ? "movie-card movie-card-rail" : "movie-card"}>
      <Link href={`/movies/${movie.id}`} className="card-image-link">
        {movie.posterUrl ? (
          <div className="poster-image-shell poster-card">
            <Image
              src={movie.posterUrl}
              alt={`${movie.title} poster`}
              fill
              sizes={imageSizes}
              className="poster-image-cover"
            />
          </div>
        ) : (
          <PosterSwatch title={movie.title} color={movie.posterColor} />
        )}
      </Link>
      <div className="card-copy">
        <h2 className="movie-title">
          <Link href={`/movies/${movie.id}`}>{movie.title}</Link>
        </h2>
        <p className="movie-meta">
          {formatMediaType(movie.mediaType)} | {formatReleaseYear(movie.releaseDate)}
        </p>
        {isRail ? (
          <p className="availability-line">{getAvailabilityLabel(movie)}</p>
        ) : (
          <p className="movie-meta">{movie.genres.join(", ")}</p>
        )}
      </div>
    </article>
  );
}
