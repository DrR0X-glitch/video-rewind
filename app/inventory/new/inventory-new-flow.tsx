"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import {
  addDiscToExistingTitle,
  createTitleAndAddToDisc,
  createTitleOnly,
} from "@/app/inventory/new/actions";
import { PosterSwatch } from "@/components/poster-swatch";
import { ZONE_OPTIONS, formatZoneLabel } from "@/lib/constants";
import { formatLinkedTitleLabel, formatMediaType, formatMovieTitleWithYear } from "@/lib/format";
import type { MovieWithInventory } from "@/lib/types";
import type { TmdbTitleDraft } from "@/lib/server/tmdb";

const DISC_DEFAULTS_STORAGE_KEY = "inventory-new-disc-defaults";
const LEGACY_DISC_DEFAULTS_STORAGE_KEY = "inventory-new-disc-defaults";
const SELECTED_TITLE_GRID_LIMIT = 6;

type DiscDraft = {
  availability: boolean;
  format: "dvd" | "blu-ray" | "4k-uhd";
  sealed: boolean;
  zone: string;
  row: string;
  dayPrice: string;
  weekendPrice: string;
  lateClass: string;
  notes: string;
  generateBarcode: boolean;
};

type DiscDefaults = Pick<DiscDraft, "format" | "sealed" | "zone" | "row"> & {
  sectionOverride?: string | null;
};

type InventoryTitleSearchResponse = {
  items: MovieWithInventory[];
  totalCount: number;
};

type SeasonDraft = {
  seasonStart: string;
  seasonEnd: string;
  episodeStart: string;
  episodeEnd: string;
};

const DEFAULT_DISC_DRAFT: DiscDraft = {
  availability: true,
  format: "blu-ray",
  sealed: false,
  zone: "W",
  row: "",
  dayPrice: "0",
  weekendPrice: "0",
  lateClass: "0",
  notes: "",
  generateBarcode: false,
};

type InventoryNewFlowProps = {
  initialSelectedMovies: MovieWithInventory[];
  duplicateMovie: MovieWithInventory | null;
  suggestedSortTitle: string;
  title: string;
  tmdbDraft: TmdbTitleDraft | null;
  tmdbInput: string;
};

export function InventoryNewFlow({
  initialSelectedMovies,
  duplicateMovie,
  suggestedSortTitle,
  title,
  tmdbDraft,
  tmdbInput,
}: InventoryNewFlowProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedMovies, setSelectedMovies] = useState(initialSelectedMovies);
  const [discDraft, setDiscDraft] = useState<DiscDraft>(DEFAULT_DISC_DRAFT);
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const [matches, setMatches] = useState<MovieWithInventory[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [formError, setFormError] = useState("");
  const [sectionOverride, setSectionOverride] = useState<string | null>(null);
  const [seasonDrafts, setSeasonDrafts] = useState<Record<string, SeasonDraft>>(() =>
    createSeasonDrafts(initialSelectedMovies),
  );

  const selectedTitleIdsValue = selectedMovies.map((movie) => movie.id).join(",");
  const defaultSectionFromTitle =
    (selectedMovies[0]?.sortTitle ?? suggestedSortTitle).charAt(0).toUpperCase() || "A";
  const sectionValue = sectionOverride ?? defaultSectionFromTitle;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const savedDefaults =
          window.localStorage.getItem(DISC_DEFAULTS_STORAGE_KEY) ??
          window.sessionStorage.getItem(LEGACY_DISC_DEFAULTS_STORAGE_KEY);

        if (!savedDefaults) {
          setDiscDraft(DEFAULT_DISC_DRAFT);
          setSectionOverride(null);
          return;
        }

        const parsedDefaults = JSON.parse(savedDefaults) as Partial<DiscDefaults>;
        const legacyCondition = (parsedDefaults as { condition?: string }).condition;
        setDiscDraft({
          availability: DEFAULT_DISC_DRAFT.availability,
          format:
            parsedDefaults.format === "dvd" ||
            parsedDefaults.format === "4k-uhd" ||
            parsedDefaults.format === "blu-ray"
              ? parsedDefaults.format
              : DEFAULT_DISC_DRAFT.format,
          sealed:
            typeof parsedDefaults.sealed === "boolean"
              ? parsedDefaults.sealed
              : legacyCondition === "sealed"
                ? true
                : legacyCondition === "not-sealed"
                  ? false
                  : DEFAULT_DISC_DRAFT.sealed,
          zone:
            typeof parsedDefaults.zone === "string" && parsedDefaults.zone
              ? parsedDefaults.zone
              : DEFAULT_DISC_DRAFT.zone,
          row: typeof parsedDefaults.row === "string" ? parsedDefaults.row : DEFAULT_DISC_DRAFT.row,
          dayPrice: DEFAULT_DISC_DRAFT.dayPrice,
          weekendPrice: DEFAULT_DISC_DRAFT.weekendPrice,
          lateClass: DEFAULT_DISC_DRAFT.lateClass,
          notes: DEFAULT_DISC_DRAFT.notes,
          generateBarcode: DEFAULT_DISC_DRAFT.generateBarcode,
        });
        setSectionOverride(
          typeof parsedDefaults.sectionOverride === "string" &&
            parsedDefaults.sectionOverride.trim()
            ? parsedDefaults.sectionOverride
            : null,
        );
      } catch {
        setDiscDraft(DEFAULT_DISC_DRAFT);
        setSectionOverride(null);
      } finally {
        setHasLoadedDraft(true);
      }
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [defaultSectionFromTitle]);

  useEffect(() => {
    if (!hasLoadedDraft) {
      return;
    }

    const defaultsToPersist: DiscDefaults = {
      format: discDraft.format,
      sealed: discDraft.sealed,
      zone: discDraft.zone,
      row: discDraft.row,
      sectionOverride,
    };

    window.localStorage.setItem(DISC_DEFAULTS_STORAGE_KEY, JSON.stringify(defaultsToPersist));
    window.sessionStorage.removeItem(LEGACY_DISC_DEFAULTS_STORAGE_KEY);
  }, [
    discDraft.format,
    discDraft.row,
    discDraft.sealed,
    discDraft.zone,
    hasLoadedDraft,
    sectionOverride,
  ]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [search]);

  useEffect(() => {
    const trimmedSearch = debouncedSearch.trim();

    if (!trimmedSearch) {
      const timeoutId = window.setTimeout(() => {
        setMatches([]);
        setIsSearching(false);
        setSearchError("");
      }, 0);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    const abortController = new AbortController();

    async function loadMatches() {
      setIsSearching(true);
      setSearchError("");

      try {
        const response = await fetch(
          `/api/inventory?search=${encodeURIComponent(trimmedSearch)}&pageSize=5`,
          { signal: abortController.signal },
        );

        if (!response.ok) {
          throw new Error("Search failed");
        }

        const data = (await response.json()) as InventoryTitleSearchResponse;
        setMatches(data.items);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setMatches([]);
        setSearchError(error instanceof Error ? error.message : "Search failed");
      } finally {
        if (!abortController.signal.aborted) {
          setIsSearching(false);
        }
      }
    }

    void loadMatches();

    return () => {
      abortController.abort();
    };
  }, [debouncedSearch]);

  function addSelectedMovie(movie: MovieWithInventory) {
    setSelectedMovies((currentMovies) =>
      currentMovies.some((currentMovie) => currentMovie.id === movie.id)
        ? currentMovies
        : [...currentMovies, movie],
    );
    setSeasonDrafts((currentDrafts) =>
      movie.mediaType === "series" && !currentDrafts[movie.id]
        ? {
            ...currentDrafts,
            [movie.id]: createEmptySeasonDraft(),
          }
        : currentDrafts,
    );
  }

  function removeSelectedMovie(movieId: string) {
    setSelectedMovies((currentMovies) => currentMovies.filter((movie) => movie.id !== movieId));
    setSeasonDrafts((currentDrafts) => {
      if (!currentDrafts[movieId]) {
        return currentDrafts;
      }

      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[movieId];
      return nextDrafts;
    });
  }

  function autofillSection() {
    setSectionOverride(null);
    setFormError("");
  }

  function validateDiscForm() {
    if (!sectionValue.trim()) {
      setFormError("Section is required.");
      return false;
    }

    if (sectionValue.trim().length < 1 || sectionValue.trim().length > 2) {
      setFormError("Section must be 1 or 2 characters.");
      return false;
    }

    if (
      discDraft.row.trim() &&
      (discDraft.row.trim().length < 1 || discDraft.row.trim().length > 2)
    ) {
      setFormError("Row must be 1 or 2 characters when provided.");
      return false;
    }

    for (const movie of selectedMovies) {
      if (movie.mediaType !== "series") {
        continue;
      }

      const seasonDraft = seasonDrafts[movie.id] ?? {
        seasonStart: "",
        seasonEnd: "",
        episodeStart: "",
        episodeEnd: "",
      };
      const startValue = seasonDraft.seasonStart.trim();
      const endValue = seasonDraft.seasonEnd.trim();
      const episodeStartValue = seasonDraft.episodeStart.trim();
      const episodeEndValue = seasonDraft.episodeEnd.trim();

      if (!startValue) {
        setFormError(`Season start is required for ${movie.title}.`);
        return false;
      }

      const seasonStart = Number.parseInt(startValue, 10);
      const seasonEnd = endValue ? Number.parseInt(endValue, 10) : seasonStart;

      if (!Number.isInteger(seasonStart) || seasonStart < 1) {
        setFormError(`Season start is invalid for ${movie.title}.`);
        return false;
      }

      if (!Number.isInteger(seasonEnd) || seasonEnd < seasonStart) {
        setFormError(
          `Season end must be greater than or equal to season start for ${movie.title}.`,
        );
        return false;
      }

      if (episodeEndValue && !episodeStartValue) {
        setFormError(`Episode start is required for ${movie.title}.`);
        return false;
      }

      if (!episodeStartValue) {
        continue;
      }

      const episodeStart = Number.parseInt(episodeStartValue, 10);
      const episodeEnd = episodeEndValue ? Number.parseInt(episodeEndValue, 10) : episodeStart;

      if (!Number.isInteger(episodeStart) || episodeStart < 1) {
        setFormError(`Episode start is invalid for ${movie.title}.`);
        return false;
      }

      if (!Number.isInteger(episodeEnd) || episodeEnd < episodeStart) {
        setFormError(
          `Episode end must be greater than or equal to episode start for ${movie.title}.`,
        );
        return false;
      }

      if (seasonEnd !== seasonStart) {
        setFormError(`Episode ranges require a single season for ${movie.title}.`);
        return false;
      }
    }

    setFormError("");
    return true;
  }

  function renderSelectedMovie(movie: MovieWithInventory) {
    const titleLabel = formatLinkedTitleLabel({
      title: movie.title,
      releaseDate: movie.releaseDate,
      mediaType: movie.mediaType,
      seasonStart: seasonDrafts[movie.id]?.seasonStart
        ? Number.parseInt(seasonDrafts[movie.id].seasonStart, 10)
        : undefined,
      seasonEnd: seasonDrafts[movie.id]?.seasonEnd
        ? Number.parseInt(seasonDrafts[movie.id].seasonEnd, 10)
        : undefined,
      episodeStart: seasonDrafts[movie.id]?.episodeStart
        ? Number.parseInt(seasonDrafts[movie.id].episodeStart, 10)
        : undefined,
      episodeEnd: seasonDrafts[movie.id]?.episodeEnd
        ? Number.parseInt(seasonDrafts[movie.id].episodeEnd, 10)
        : undefined,
    });

    return (
      <li
        key={movie.id}
        className={`selected-title-card${movie.id === selectedMovies[0]?.id ? " selected-title-card-primary" : ""}`}
      >
        <div className="selected-title-poster">
          {movie.posterUrl ? (
            <Image
              src={movie.posterUrl}
              alt={`${movie.title} poster`}
              fill
              sizes="(max-width: 420px) 100vw, 50vw"
              className="poster-image-cover"
            />
          ) : (
            <PosterSwatch title={movie.title} color={movie.posterColor} />
          )}
        </div>
        <div className="selected-title-copy">
          <strong>{titleLabel}</strong>
          <span className="muted">{formatMediaType(movie.mediaType)}</span>
          <button type="button" onClick={() => removeSelectedMovie(movie.id)}>
            Remove
          </button>
        </div>
      </li>
    );
  }

  return (
    <>
      <section className="panel section">
        <h2>1. Search Existing Titles</h2>
        <div className="inline-form">
          <label className="search-label">
            <span>Title</span>
            <input
              type="text"
              name="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search before creating a title"
              autoComplete="off"
            />
          </label>
        </div>
        {debouncedSearch.trim() ? (
          <div className="search-results">
            {isSearching ? <p className="muted">Searching…</p> : null}
            {!isSearching && searchError ? <p>{searchError}</p> : null}
            {!isSearching && !searchError ? (
              matches.length > 0 ? (
                <>
                  <p className="muted">Showing up to 5 matches.</p>
                  <ul className="plain-list plain-actions">
                    {matches.map((movie) => {
                      const isSelected = selectedMovies.some(
                        (selectedMovie) => selectedMovie.id === movie.id,
                      );

                      return (
                        <li key={movie.id}>
                          <span>{formatMovieTitleWithYear(movie.title, movie.releaseDate)}</span>
                          <span className="muted">
                            {formatMediaType(movie.mediaType)} | {movie.totalCopies} copies
                          </span>
                          <button
                            type="button"
                            onClick={() => addSelectedMovie(movie)}
                            disabled={isSelected}
                          >
                            {isSelected ? "Selected" : "Add To Disc"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p>No title found. Continue with the TMDB link below.</p>
              )
            ) : null}
          </div>
        ) : null}
      </section>

      {selectedMovies.length > 0 ? (
        <div className="two-column">
          <section className="panel section">
            <h2>2. Titles On Disc</h2>
            {selectedMovies.length <= SELECTED_TITLE_GRID_LIMIT ? (
              <ul className="selected-title-grid">{selectedMovies.map(renderSelectedMovie)}</ul>
            ) : (
              <ul className="plain-list plain-actions">
                {selectedMovies.map((movie) => (
                  <li
                    key={movie.id}
                    className={
                      movie.id === selectedMovies[0]?.id ? "selected-title-primary" : undefined
                    }
                  >
                    <span>
                      {formatLinkedTitleLabel({
                        title: movie.title,
                        releaseDate: movie.releaseDate,
                        mediaType: movie.mediaType,
                        seasonStart: seasonDrafts[movie.id]?.seasonStart
                          ? Number.parseInt(seasonDrafts[movie.id].seasonStart, 10)
                          : undefined,
                        seasonEnd: seasonDrafts[movie.id]?.seasonEnd
                          ? Number.parseInt(seasonDrafts[movie.id].seasonEnd, 10)
                          : undefined,
                        episodeStart: seasonDrafts[movie.id]?.episodeStart
                          ? Number.parseInt(seasonDrafts[movie.id].episodeStart, 10)
                          : undefined,
                        episodeEnd: seasonDrafts[movie.id]?.episodeEnd
                          ? Number.parseInt(seasonDrafts[movie.id].episodeEnd, 10)
                          : undefined,
                      })}
                    </span>
                    <span className="muted">{formatMediaType(movie.mediaType)}</span>
                    <button type="button" onClick={() => removeSelectedMovie(movie.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel section">
            <h2>3. Disc</h2>
            {formError ? <p className="form-error">{formError}</p> : null}
            <form
              action={addDiscToExistingTitle}
              className="stack-form"
              onSubmit={(event) => {
                if (!validateDiscForm()) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="titleIds" value={selectedTitleIdsValue} />
              <DiscFields
                defaultSectionFromTitle={defaultSectionFromTitle}
                discDraft={discDraft}
                onAutofillSection={autofillSection}
                seasonDrafts={seasonDrafts}
                selectedMovies={selectedMovies}
                sectionValue={sectionValue}
                setSeasonDrafts={setSeasonDrafts}
                setSectionOverride={setSectionOverride}
                setDiscDraft={setDiscDraft}
              />
              <button type="submit">Save Disc</button>
            </form>
          </section>
        </div>
      ) : (
        <>
          <section className="panel section">
            <h2>2. Resolve Title from TMDB</h2>
            <form className="stack-form">
              <label>
                TMDB link
                <input
                  type="text"
                  name="tmdb"
                  defaultValue={tmdbInput}
                  placeholder="https://www.themoviedb.org/movie/11-star-wars"
                />
              </label>
              <button type="submit">Load Title</button>
            </form>
          </section>

          {duplicateMovie ? (
            <section className="panel section">
              <h2>Existing Match Found</h2>
              <p className="selected-title">
                {formatMovieTitleWithYear(duplicateMovie.title, duplicateMovie.releaseDate)}
              </p>
              <p className="muted">
                This TMDB title already exists in the catalogue. Add the disc to the existing title
                instead.
              </p>
              <button type="button" onClick={() => addSelectedMovie(duplicateMovie)}>
                Use Existing Title
              </button>
            </section>
          ) : null}

          {tmdbDraft && !duplicateMovie ? (
            <form action={createTitleAndAddToDisc}>
              <input type="hidden" name="tmdb" value={tmdbInput} />
              <input type="hidden" name="titleIds" value={selectedTitleIdsValue} />
              <section className="panel section">
                <h2>3. Title Setup</h2>
                <div className="stack-form">
                  <label>
                    Title
                    <input type="text" name="title" defaultValue={title} />
                  </label>
                  <label>
                    Sort title
                    <input type="text" name="sortTitle" defaultValue={suggestedSortTitle} />
                  </label>
                  <dl className="meta-list compact-meta info-list">
                    <div>
                      <dt>Type</dt>
                      <dd>{formatMediaType(tmdbDraft.mediaType)}</dd>
                    </div>
                    <div>
                      <dt>Release date</dt>
                      <dd>{tmdbDraft.releaseDate || "—"}</dd>
                    </div>
                    <div>
                      <dt>Director / creator</dt>
                      <dd>{tmdbDraft.director || "—"}</dd>
                    </div>
                    <div>
                      <dt>Genres</dt>
                      <dd>{tmdbDraft.genres.join(", ") || "—"}</dd>
                    </div>
                  </dl>
                  <div className="split-action-row">
                    <button type="submit" className="action-grow-two">
                      Add To Disc
                    </button>
                    <button type="submit" formAction={createTitleOnly} className="action-grow-one">
                      Create Title
                    </button>
                  </div>
                </div>
              </section>
            </form>
          ) : null}
        </>
      )}
    </>
  );
}

function DiscFields({
  defaultSectionFromTitle,
  discDraft,
  onAutofillSection,
  seasonDrafts,
  selectedMovies,
  sectionValue,
  setSeasonDrafts,
  setSectionOverride,
  setDiscDraft,
}: {
  defaultSectionFromTitle: string;
  discDraft: DiscDraft;
  onAutofillSection: () => void;
  seasonDrafts: Record<string, SeasonDraft>;
  selectedMovies: MovieWithInventory[];
  sectionValue: string;
  setSeasonDrafts: React.Dispatch<React.SetStateAction<Record<string, SeasonDraft>>>;
  setSectionOverride: React.Dispatch<React.SetStateAction<string | null>>;
  setDiscDraft: React.Dispatch<React.SetStateAction<DiscDraft>>;
}) {
  return (
    <>
      <label>
        Format
        <span className="button-choice-group">
          <label className="choice-button">
            <input
              type="radio"
              name="format"
              value="dvd"
              checked={discDraft.format === "dvd"}
              onChange={() => setDiscDraft((currentDraft) => ({ ...currentDraft, format: "dvd" }))}
            />
            <span>DVD</span>
          </label>
          <label className="choice-button">
            <input
              type="radio"
              name="format"
              value="blu-ray"
              checked={discDraft.format === "blu-ray"}
              onChange={() =>
                setDiscDraft((currentDraft) => ({ ...currentDraft, format: "blu-ray" }))
              }
            />
            <span>Blu-ray</span>
          </label>
          <label className="choice-button">
            <input
              type="radio"
              name="format"
              value="4k-uhd"
              checked={discDraft.format === "4k-uhd"}
              onChange={() =>
                setDiscDraft((currentDraft) => ({ ...currentDraft, format: "4k-uhd" }))
              }
            />
            <span>4K UHD</span>
          </label>
        </span>
      </label>
      <label>
        Zone
        <span className="button-choice-group">
          {ZONE_OPTIONS.map((zone) => (
            <label key={zone} className="choice-button">
              <input
                type="radio"
                name="zone"
                value={zone}
                checked={discDraft.zone === zone}
                onChange={() => setDiscDraft((currentDraft) => ({ ...currentDraft, zone }))}
              />
              <span>{formatZoneLabel(zone)}</span>
            </label>
          ))}
        </span>
      </label>
      <label>
        <span className="form-label-row">
          <span>Section</span>
          {!sectionValue.trim() ? (
            <button type="button" className="link-button" onClick={onAutofillSection}>
              Autofill ({defaultSectionFromTitle})
            </button>
          ) : null}
        </span>
        <input
          type="text"
          name="section"
          required
          maxLength={2}
          value={sectionValue}
          onChange={(event) => {
            const nextValue = event.target.value.toUpperCase().slice(0, 2);
            setSectionOverride(nextValue);
          }}
        />
      </label>
      <label>
        Row (optional)
        <input
          type="text"
          name="row"
          maxLength={2}
          value={discDraft.row}
          onChange={(event) =>
            setDiscDraft((currentDraft) => ({
              ...currentDraft,
              row: event.target.value.toUpperCase().slice(0, 2),
            }))
          }
        />
      </label>
      <div className="inline-split">
        <label className="checkbox-row">
          <input
            type="checkbox"
            name="availability"
            value="true"
            checked={discDraft.availability}
            onChange={(event) =>
              setDiscDraft((currentDraft) => ({
                ...currentDraft,
                availability: event.target.checked,
              }))
            }
          />
          <span>Available</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            name="sealed"
            value="true"
            checked={discDraft.sealed}
            onChange={(event) =>
              setDiscDraft((currentDraft) => ({
                ...currentDraft,
                sealed: event.target.checked,
              }))
            }
          />
          <span>Sealed</span>
        </label>
      </div>
      <label>
        Day price
        <input
          type="text"
          name="dayPrice"
          value={discDraft.dayPrice}
          onChange={(event) =>
            setDiscDraft((currentDraft) => ({ ...currentDraft, dayPrice: event.target.value }))
          }
        />
      </label>
      <label>
        Weekend price
        <input
          type="text"
          name="weekendPrice"
          value={discDraft.weekendPrice}
          onChange={(event) =>
            setDiscDraft((currentDraft) => ({ ...currentDraft, weekendPrice: event.target.value }))
          }
        />
      </label>
      <label>
        Late class
        <input
          type="text"
          name="lateClass"
          value={discDraft.lateClass}
          onChange={(event) =>
            setDiscDraft((currentDraft) => ({ ...currentDraft, lateClass: event.target.value }))
          }
        />
      </label>
      {selectedMovies.map((movie) => {
        const seasonDraft = seasonDrafts[movie.id] ?? {
          seasonStart: "",
          seasonEnd: "",
          episodeStart: "",
          episodeEnd: "",
        };

        return (
          <div key={`linked-${movie.id}`} className="linked-title-fields">
            <input type="hidden" name="linkedTitleId" value={movie.id} />
            {movie.mediaType === "series" ? (
              <div className="inline-split">
                <label>
                  <span>{movie.title} season start</span>
                  <input
                    type="text"
                    name="seasonStart"
                    value={seasonDraft.seasonStart}
                    onChange={(event) =>
                      setSeasonDrafts((currentDrafts) => ({
                        ...currentDrafts,
                        [movie.id]: {
                          seasonStart: event.target.value.replace(/\D/g, ""),
                          seasonEnd: currentDrafts[movie.id]?.seasonEnd ?? "",
                          episodeStart: currentDrafts[movie.id]?.episodeStart ?? "",
                          episodeEnd: currentDrafts[movie.id]?.episodeEnd ?? "",
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{movie.title} season end</span>
                  <input
                    type="text"
                    name="seasonEnd"
                    value={seasonDraft.seasonEnd}
                    placeholder={seasonDraft.seasonStart || "Same as start"}
                    onChange={(event) =>
                      setSeasonDrafts((currentDrafts) => ({
                        ...currentDrafts,
                        [movie.id]: {
                          seasonStart: currentDrafts[movie.id]?.seasonStart ?? "",
                          seasonEnd: event.target.value.replace(/\D/g, ""),
                          episodeStart: currentDrafts[movie.id]?.episodeStart ?? "",
                          episodeEnd: currentDrafts[movie.id]?.episodeEnd ?? "",
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{movie.title} episode start</span>
                  <input
                    type="text"
                    name="episodeStart"
                    value={seasonDraft.episodeStart}
                    placeholder="Whole season"
                    onChange={(event) =>
                      setSeasonDrafts((currentDrafts) => ({
                        ...currentDrafts,
                        [movie.id]: {
                          seasonStart: currentDrafts[movie.id]?.seasonStart ?? "",
                          seasonEnd: currentDrafts[movie.id]?.seasonEnd ?? "",
                          episodeStart: event.target.value.replace(/\D/g, ""),
                          episodeEnd: currentDrafts[movie.id]?.episodeEnd ?? "",
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{movie.title} episode end</span>
                  <input
                    type="text"
                    name="episodeEnd"
                    value={seasonDraft.episodeEnd}
                    placeholder={seasonDraft.episodeStart || "Same as start"}
                    onChange={(event) =>
                      setSeasonDrafts((currentDrafts) => ({
                        ...currentDrafts,
                        [movie.id]: {
                          seasonStart: currentDrafts[movie.id]?.seasonStart ?? "",
                          seasonEnd: currentDrafts[movie.id]?.seasonEnd ?? "",
                          episodeStart: currentDrafts[movie.id]?.episodeStart ?? "",
                          episodeEnd: event.target.value.replace(/\D/g, ""),
                        },
                      }))
                    }
                  />
                </label>
              </div>
            ) : (
              <>
                <input type="hidden" name="seasonStart" value="" />
                <input type="hidden" name="seasonEnd" value="" />
                <input type="hidden" name="episodeStart" value="" />
                <input type="hidden" name="episodeEnd" value="" />
              </>
            )}
          </div>
        );
      })}
      <label>
        Notes
        <textarea
          name="notes"
          rows={4}
          value={discDraft.notes}
          onChange={(event) =>
            setDiscDraft((currentDraft) => ({ ...currentDraft, notes: event.target.value }))
          }
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          name="generateBarcode"
          value="true"
          checked={discDraft.generateBarcode}
          onChange={(event) =>
            setDiscDraft((currentDraft) => ({
              ...currentDraft,
              generateBarcode: event.target.checked,
            }))
          }
        />
        <span>Open label after save</span>
      </label>
    </>
  );
}

function createEmptySeasonDraft(): SeasonDraft {
  return {
    seasonStart: "",
    seasonEnd: "",
    episodeStart: "",
    episodeEnd: "",
  };
}

function createSeasonDrafts(movies: MovieWithInventory[]) {
  const drafts: Record<string, SeasonDraft> = {};

  for (const movie of movies) {
    drafts[movie.id] = createEmptySeasonDraft();
  }

  return drafts;
}
