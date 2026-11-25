import Link from "next/link";
import Image from "next/image";

import { PosterSwatch } from "@/components/poster-swatch";
import { getPublicMovieById } from "@/lib/data";
import {
  formatAvailability,
  formatImdbRating,
  formatMediaType,
  formatMovieTitleWithYear,
  formatReleaseYear,
  formatDiscFormat,
  getAvailabilityLabel,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MovieDetailPage(props: PageProps<"/movies/[id]">) {
  const { id } = await props.params;
  const movie = await getPublicMovieById(id);
  const sortedInventoryItems = movie.inventoryItems.slice().sort((a, b) => {
    return getFormatPriority(a.format) - getFormatPriority(b.format);
  });

  return (
    <div className="detail-page">
      <p className="detail-back-link">
        <Link href="/search">Back</Link>
      </p>
      <div className="detail-grid">
        {movie.posterUrl ? (
          <div className="detail-poster">
            <div className="poster-image-shell poster-detail">
              <Image
                src={movie.posterUrl}
                alt={`${movie.title} poster`}
                fill
                loading="eager"
                sizes="(max-width: 820px) 100vw, 320px"
                className="poster-image-cover"
              />
            </div>
          </div>
        ) : (
          <PosterSwatch title={movie.title} color={movie.posterColor} size="detail" />
        )}
        <section className="detail-copy">
          <h1>{formatMovieTitleWithYear(movie.title, movie.releaseYear)}</h1>
          <p className="muted">
            {formatMediaType(movie.mediaType)} | Sort title: {movie.sortTitle}
          </p>
          <p>{movie.overview}</p>
          <dl className="meta-list">
            <div>
              <dt>{movie.mediaType === "series" ? "First aired" : "Released"}</dt>
              <dd>{formatReleaseYear(movie.releaseYear)}</dd>
            </div>
            <div>
              <dt>Genres</dt>
              <dd>{movie.genres.join(", ")}</dd>
            </div>
            <div>
              <dt>IMDb</dt>
              <dd>{formatImdbRating(movie.imdbRating)}</dd>
            </div>
            <div>
              <dt>{movie.mediaType === "series" ? "Creator" : "Director"}</dt>
              <dd>{movie.director}</dd>
            </div>
            <div>
              <dt>Cast</dt>
              <dd>{movie.cast.join(", ")}</dd>
            </div>
            <div>
              <dt>Stock</dt>
              <dd>{getAvailabilityLabel(movie)}</dd>
            </div>
          </dl>
          {movie.inventoryItems.length > 0 ? (
            <section className="detail-stock-table">
              <h2>Available Copies</h2>
              <table>
                <thead>
                  <tr>
                    <th>Copy</th>
                    <th>Format</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedInventoryItems.map((item, index) => (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td>{formatDiscFormat(item.format)}</td>
                      <td>{formatAvailability(item.availability)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          {movie.collection && movie.collectionTitles.length > 0 ? (
            <section className="detail-collection">
              <p className="eyebrow">In This Collection</p>
              <h2>{movie.collection.name}</h2>
              <ul className="detail-collection-list">
                {movie.collectionTitles.map((title) => (
                  <li key={title.id}>
                    {title.id === movie.id ? (
                      <span className="detail-collection-current">
                        {formatMovieTitleWithYear(title.title, title.releaseYear)}
                      </span>
                    ) : (
                      <Link href={`/movies/${title.id}`}>
                        {formatMovieTitleWithYear(title.title, title.releaseYear)}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function getFormatPriority(format: "dvd" | "blu-ray" | "4k-uhd" | "vhs") {
  switch (format) {
    case "4k-uhd":
      return 0;
    case "blu-ray":
      return 1;
    case "vhs":
      return 3;
    default:
      return 2;
  }
}
