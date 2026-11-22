"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [genre, setGenre] = useState(initialGenre);
  const [decade, setDecade] = useState(initialDecade);
  const [sort, setSort] = useState(initialSort);
  const [availableOnly, setAvailableOnly] = useState(initialAvailable);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [results, setResults] = useState<MovieWithInventory[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const previousFilterKeyRef = useRef("");
  const currentPage = parsePositiveInteger(searchParams.get("page")) ?? initialPage;

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
    const resetPage = previousFilterKeyRef.current !== "" && previousFilterKeyRef.current !== filterKey;
    previousFilterKeyRef.current = filterKey;

    const nextPage = resetPage ? 1 : currentPage;
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

    if (nextPage > 1) {
      params.set("page", nextPage.toString());
    }

    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }, [availableOnly, currentPage, decade, debouncedQuery, genre, pathname, router, sort]);

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

    params.set("page", currentPage.toString());
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
  }, [availableOnly, currentPage, decade, debouncedQuery, genre, sort]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PUBLIC_PAGE_SIZE));
  const currentPageOnResultSet = Math.min(currentPage, totalPages);
  const pageStart = totalCount === 0 ? 0 : (currentPageOnResultSet - 1) * PUBLIC_PAGE_SIZE + 1;
  const pageEnd = totalCount === 0 ? 0 : pageStart + results.length - 1;
  const previousPageHref =
    currentPageOnResultSet > 1
      ? buildCatalogueHref(pathname, debouncedQuery, genre, decade, sort, availableOnly, currentPageOnResultSet - 1)
      : null;
  const nextPageHref =
    currentPageOnResultSet < totalPages
      ? buildCatalogueHref(pathname, debouncedQuery, genre, decade, sort, availableOnly, currentPageOnResultSet + 1)
      : null;

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
        {totalCount > PUBLIC_PAGE_SIZE || currentPageOnResultSet > 1 ? (
          <div className="section stock-table-footer">
            <div className="header-actions stock-pagination">
              {previousPageHref ? (
                <Link href={previousPageHref}>Previous</Link>
              ) : (
                <span className="muted">Previous</span>
              )}
              <span className="muted">Page {currentPageOnResultSet} of {totalPages}</span>
              {nextPageHref ? (
                <Link href={nextPageHref}>Next</Link>
              ) : (
                <span className="muted">Next</span>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function parsePositiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

function buildCatalogueHref(
  pathname: string,
  query: string,
  genre: string,
  decade: string,
  sort: string,
  availableOnly: boolean,
  page: number,
) {
  const params = new URLSearchParams();

  if (query.trim()) {
    params.set("q", query.trim());
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

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}
