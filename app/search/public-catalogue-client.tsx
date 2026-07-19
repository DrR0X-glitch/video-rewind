"use client";

import { useEffect, useRef, useState } from "react";
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
  initialPage: number;
};

type PublicCataloguePage = {
  items: MovieWithInventory[];
  totalCount: number;
};

const PUBLIC_PAGE_SIZE = 24;

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
  initialPage,
}: PublicCatalogueClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const [genre, setGenre] = useState(initialGenre);
  const [decade, setDecade] = useState(initialDecade);
  const [sort, setSort] = useState(initialSort);
  const [availableOnly, setAvailableOnly] = useState(initialAvailable);
  const [page, setPage] = useState(initialPage);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [results, setResults] = useState<MovieWithInventory[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const previousFilterKeyRef = useRef("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  useEffect(() => {
    const filterKey = [debouncedQuery.trim(), genre, decade, sort, availableOnly ? "1" : "0"].join("|");

    if (previousFilterKeyRef.current && previousFilterKeyRef.current !== filterKey) {
      setPage(1);
    }

    previousFilterKeyRef.current = filterKey;
  }, [availableOnly, decade, debouncedQuery, genre, sort]);

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

    if (page > 1) {
      params.set("page", page.toString());
    }

    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }, [availableOnly, decade, debouncedQuery, genre, page, pathname, router, sort]);

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

    params.set("page", page.toString());
    params.set("pageSize", PUBLIC_PAGE_SIZE.toString());

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

        const data = (await response.json()) as PublicCataloguePage;
        setResults(Array.isArray(data.items) ? data.items : []);
        setTotalCount(typeof data.totalCount === "number" ? data.totalCount : 0);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setResults([]);
        setTotalCount(0);
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
  }, [availableOnly, decade, debouncedQuery, genre, page, sort]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PUBLIC_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = totalCount === 0 ? 0 : (currentPage - 1) * PUBLIC_PAGE_SIZE + 1;
  const pageEnd = totalCount === 0 ? 0 : pageStart + results.length - 1;

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
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search title, cast, genre, director, or description"
            autoComplete="off"
          />
        </div>
      </section>

      <section className="panel section">
        <div className="search-filter-row">
          <label>
            <span>Genre</span>
            <select
              value={genre}
              onChange={(event) => {
                setGenre(event.target.value);
                setPage(1);
              }}
            >
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
            <select
              value={decade}
              onChange={(event) => {
                setDecade(event.target.value);
                setPage(1);
              }}
            >
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
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
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
              onChange={(event) => {
                setAvailableOnly(event.target.checked);
                setPage(1);
              }}
            />
            <span>Available only</span>
          </label>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Results</h2>
          <p className="muted utility-row">
            {isSearching ? "Searching…" : totalCount === 0 ? "0 matching titles" : `Showing ${pageStart}-${pageEnd} of ${totalCount}`}
          </p>
        </div>
        {searchError ? (
          <section className="panel section">
            <p>{searchError}</p>
          </section>
        ) : null}
        {!searchError && !isSearching && totalCount === 0 ? (
          <section className="panel section">
            <p>No titles match the current search and filters.</p>
          </section>
        ) : null}
        <div className="movie-grid catalogue-grid">
          {results.map((movie) => (
            <MovieCard key={movie.id} movie={movie} />
          ))}
        </div>
        {totalCount > PUBLIC_PAGE_SIZE || page > 1 ? (
          <div className="section stock-table-footer">
            <p className="muted utility-row">
              Page {currentPage} of {totalPages}
            </p>
            <div className="header-actions stock-pagination">
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1}>
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
