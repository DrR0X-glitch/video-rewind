"use client";

import { useEffect, useRef, useState } from "react";

import { MovieCard } from "@/components/movie-card";
import type { MovieWithInventory } from "@/lib/types";

type MovieRailProps = {
  title: string;
  description?: string;
  movies: MovieWithInventory[];
};

export function MovieRail({ title, description, movies }: MovieRailProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const shell = shellRef.current;

    if (!shell) {
      return;
    }

    function updateScrollState() {
      const currentShell = shellRef.current;

      if (!currentShell) {
        return;
      }

      const maxScrollLeft = currentShell.scrollWidth - currentShell.clientWidth;
      setCanScrollLeft(currentShell.scrollLeft > 4);
      setCanScrollRight(maxScrollLeft - currentShell.scrollLeft > 4);
    }

    updateScrollState();
    shell.addEventListener("scroll", updateScrollState, { passive: true });
    const observer = new ResizeObserver(() => {
      updateScrollState();
    });
    observer.observe(shell);

    return () => {
      shell.removeEventListener("scroll", updateScrollState);
      observer.disconnect();
    };
  }, []);

  if (movies.length === 0) {
    return null;
  }

  function scrollRail(direction: -1 | 1) {
    const shell = shellRef.current;

    if (!shell) {
      return;
    }

    const firstItem = shell.querySelector<HTMLElement>(".movie-rail-item");
    const track = shell.querySelector<HTMLElement>(".movie-rail");
    const itemWidth = firstItem?.getBoundingClientRect().width ?? 0;
    const gap = track
      ? Number.parseFloat(
          window.getComputedStyle(track).columnGap || window.getComputedStyle(track).gap || "0",
        )
      : 0;
    const itemsPerView =
      Number.parseInt(
        window.getComputedStyle(shell).getPropertyValue("--items-per-view").trim(),
        10,
      ) || 6;
    const advanceCount = Math.max(1, itemsPerView - 2);
    const distance = (itemWidth + gap) * advanceCount;

    shell.scrollBy({
      left: direction * distance,
      behavior: "smooth",
    });
  }

  return (
    <section className="section">
      <div className="section-heading movie-rail-heading">
        <div>
          <h2>{title}</h2>
          {description ? <p className="muted utility-row">{description}</p> : null}
        </div>
        <div className="movie-rail-controls" aria-label={`${title} controls`}>
          <button
            type="button"
            onClick={() => scrollRail(-1)}
            aria-disabled={!canScrollLeft}
            className={!canScrollLeft ? "is-disabled" : undefined}
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => scrollRail(1)}
            aria-disabled={!canScrollRight}
            className={!canScrollRight ? "is-disabled" : undefined}
          >
            →
          </button>
        </div>
      </div>
      <div ref={shellRef} className="movie-rail-shell">
        <div className="movie-rail" aria-label={title}>
          {movies.map((movie) => (
            <div key={movie.id} className="movie-rail-item">
              <MovieCard movie={movie} variant="rail" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
