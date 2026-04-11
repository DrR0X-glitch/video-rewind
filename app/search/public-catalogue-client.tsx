"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { MovieCard } from "@/components/movie-card";
import type { MovieWithInventory } from "@/lib/types";

type PublicCatalogueClientProps = {
  decades: Array<{ label: string; value: string }>;
  genres: string[];
  initialAvailable: boolean;
  initialDecade: string;
  initialGenre: string;
  initialQuery: string;
  initialSort: string;
};

const sortOptions = [
  { value: "title", label: "Alphabetical" },
  { value: "rating-desc", label: "Highest rated" },
  { value: "popular", label: "Most popular" },
  { value: "year-desc", label: "Newest first" },
  { value: "year-asc", label: "Oldest first" },
] as const;

export function PublicCatalogueClient({
  decades = [],
  genres = [],
  initialAvailable,
  initialDecade,
  initialGenre,
  initialQuery,
  initialSort,
}: PublicCatalogueClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const [genre, setGenre] = useState(initialGenre);
  const [decade, setDecade] = useState(initialDecade);
  const [sort, setSort] = useState(initialSort);
  const [availableOnly, setAvailableOnly] = useState(initialAvailable);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [results, setResults] = useState<MovieWithInventory[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  useEffect(() => {
    const params = new URLSearchParams();

    if (debouncedQuery.trim()) {
      params.set("q", debouncedQuery.trim());
    }

    if (genre !== "all") {
      params.set("genre", genre);
    }

    if (decade !== "all") {
      params.set("decade", decade);
    }

    if (sort !== "title") {
      params.set("sort", sort);
    }

    if (availableOnly) {
      params.set("available", "true");
    }

    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }, [availableOnly, decade, debouncedQuery, genre, pathname, router, sort]);

  useEffect(() => {
    const abortController = new AbortController();
    const params = new URLSearchParams();

    if (debouncedQuery.trim()) {
      params.set("search", debouncedQuery.trim());
    }

    if (genre !== "all") {
      params.set("genre", genre);
    }

    if (decade !== "all") {
      params.set("decade", decade);
    }

    if (sort !== "title") {
      params.set("sort", sort);
    }

    if (availableOnly) {
      params.set("available", "true");
    }

    async function runSearch() {
      setIsSearching(true);
      setSearchError("");

      try {
        const response = await fetch(`/api/movies?${params.toString()}`, {
          signal: abortController.signal,
        });

        if (!response.ok) {
          let message = "Search failed";

          try {
            const payload = (await response.json()) as { error?: string };
            if (typeof payload?.error === "string" && payload.error.trim()) {
              message = payload.error;
            }
          } catch {}

          throw new Error(message);
        }

        const data = (await response.json()) as MovieWithInventory[];
        setResults(data);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setResults([]);
        setSearchError(error instanceof Error ? error.message : "Search failed");
      } finally {
        if (!abortController.signal.aborted) {
          setIsSearching(false);
        }
      }
    }

    void runSearch();

    return () => {
      abortController.abort();
    };
  }, [availableOnly, decade, debouncedQuery, genre, sort]);

  return (
    <div className="search-catalogue">
      <section className="panel section search-hero">
        <p className="eyebrow">Full Catalogue</p>
        <h1>Search the collection</h1>
        <div className="search-catalogue-bar">
          <label htmlFor="public-catalogue-search" className="sr-only">
            Search catalogue
          </label>
          <input
            id="public-catalogue-search"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, cast, genre, director, or description"
            autoComplete="off"
          />
        </div>
      </section>

      <section className="panel section">
        <div className="search-filter-row">
          <label>
            <span>Genre</span>
            <select value={genre} onChange={(event) => setGenre(event.target.value)}>
              <option value="all">All genres</option>
              {genres.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Decade</span>
            <select value={decade} onChange={(event) => setDecade(event.target.value)}>
              <option value="all">All decades</option>
              {decades.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-row search-filter-toggle">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(event) => setAvailableOnly(event.target.checked)}
            />
            <span>Available only</span>
          </label>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Results</h2>
          <p className="muted utility-row">
            {isSearching ? "Searching…" : `${results.length} matching titles`}
          </p>
        </div>
        {searchError ? (
          <section className="panel section">
            <p>{searchError}</p>
          </section>
        ) : null}
        {!searchError && !isSearching && results.length === 0 ? (
          <section className="panel section">
            <p>No titles match the current search and filters.</p>
          </section>
        ) : null}
        <div className="movie-grid catalogue-grid">
          {results.map((movie) => (
            <MovieCard key={movie.id} movie={movie} />
          ))}
        </div>
      </section>
    </div>
  );
}
