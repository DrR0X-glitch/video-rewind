import { MovieRail } from "@/components/movie-rail";
import {
  filterMovies,
  getFeaturedMovies,
  getHighestRatedMoviesByMediaType,
  getPopularMoviesByMediaType,
  getRecentlyReturnedMovies,
  getTopGenres,
} from "@/lib/data";

const HOME_RAIL_LIMIT = 60;
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [featured, highestRatedMovies, popularMovies, popularSeries, recentlyReturned, topGenres] =
    await Promise.all([
      getFeaturedMovies(),
      getHighestRatedMoviesByMediaType("movie", HOME_RAIL_LIMIT),
      getPopularMoviesByMediaType("movie", HOME_RAIL_LIMIT),
      getPopularMoviesByMediaType("series", HOME_RAIL_LIMIT),
      getRecentlyReturnedMovies(HOME_RAIL_LIMIT),
      getTopGenres(3, { excludeHomepageHidden: true }),
    ]);

  const genreRows = await Promise.all(
    topGenres.map(async (genre) => ({
      genre,
      movies: await filterMovies({
        genre,
        excludeHomepageHidden: true,
        limit: HOME_RAIL_LIMIT,
        sort: "rating-desc",
      }),
    })),
  );

  return (
    <div className="public-home">
      <section className="panel section home-intro">
        <div className="home-intro-copy">
          <p className="eyebrow">Browse The Collection</p>
          <h1>Find something worth pulling off the shelf.</h1>
        </div>
        <form action="/search" method="get" className="home-search-form">
          <label htmlFor="home-search" className="sr-only">
            Search the catalogue
          </label>
          <input id="home-search" type="text" name="q" placeholder="Search the catalogue" />
          <button type="submit">Search</button>
        </form>
      </section>

      <MovieRail title="Featured" movies={featured} />
      <MovieRail title="Highest Rated Movies" movies={highestRatedMovies} />
      <MovieRail title="Popular Movies" movies={popularMovies} />
      <MovieRail title="Popular TV" movies={popularSeries} />
      <MovieRail title="Recently Returned" movies={recentlyReturned} />
      {genreRows.map((row) => (
        <MovieRail key={row.genre} title={row.genre} movies={row.movies} />
      ))}
    </div>
  );
}
