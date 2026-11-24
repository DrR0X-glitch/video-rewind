"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import { UpcEanInput } from "@/components/upc-ean-input";
import { formatZoneLabel } from "@/lib/constants";
import type { InventoryZone } from "@/lib/inventory-zones";

type DiscogsCandidate = {
  discogsReleaseId: number;
  title: string;
  releaseYear: number | null;
  country: string | null;
  formats: string[];
  labels: string[];
  catalogNumber: string | null;
  discogsUrl: string;
};

type DiscogsTrack = {
  sequenceNo: number;
  position: string;
  title: string;
  entryType: "track" | "heading";
  durationSeconds: number | null;
  parentSequenceNo?: number | null;
  parentTrackId?: string | null;
};

type DiscogsRelease = DiscogsCandidate & {
  artists: string[];
  label: string | null;
  artworkUrl: string | null;
  tracks: DiscogsTrack[];
};

type ExistingMusicRelease = {
  id: string;
  discogsReleaseId: number;
  title: string;
  sortTitle: string;
  artistCredit: string;
  releaseYear: number | null;
  country: string | null;
  label: string | null;
  catalogNumber: string | null;
  discogsUrl: string;
  tracks: DiscogsTrack[];
};

type SearchResponse = {
  results: DiscogsCandidate[];
  totalResults: number;
};

type CdIntakeFlowProps = {
  zones: InventoryZone[];
  defaultZone: string;
};

const DISC_DEFAULTS_STORAGE_KEY = "inventory-new-disc-defaults";

type DiscDefaults = {
  format?: unknown;
  sealed?: unknown;
  zone?: unknown;
  row?: unknown;
  sectionOverride?: unknown;
};

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function truncateResultMetadata(value: string, maxLength: number) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function suggestedSortTitle(title: string) {
  return title.replace(/^(a|an|the)\s+/i, "").trim() || title.trim();
}

export function CdIntakeFlow({ zones, defaultZone }: CdIntakeFlowProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DiscogsCandidate[]>([]);
  const [selectedRelease, setSelectedRelease] = useState<DiscogsRelease | null>(null);
  const [existingRelease, setExistingRelease] = useState<ExistingMusicRelease | null>(null);
  const [releaseSortTitle, setReleaseSortTitle] = useState("");
  const [savedRelease, setSavedRelease] = useState<{
    id: string;
    title: string;
    sortTitle: string;
  } | null>(null);
  const [inventoryZoneCode, setInventoryZoneCode] = useState(defaultZone);
  const [row, setRow] = useState("");
  const [sealed, setSealed] = useState(false);
  const [sectionOverride, setSectionOverride] = useState<string | null>(null);
  const [hasLoadedDiscDefaults, setHasLoadedDiscDefaults] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualSortTitle, setManualSortTitle] = useState("");
  const [manualSortTitleEdited, setManualSortTitleEdited] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingCopy, setAddingCopy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const confirmationRef = useRef<HTMLElement>(null);
  const defaultSectionFromRelease = savedRelease?.sortTitle.charAt(0).toUpperCase() || "A";
  const sectionValue = sectionOverride ?? defaultSectionFromRelease;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const savedDefaults = window.localStorage.getItem(DISC_DEFAULTS_STORAGE_KEY);
        if (savedDefaults) {
          const parsed = JSON.parse(savedDefaults) as DiscDefaults;
          setInventoryZoneCode(
            typeof parsed.zone === "string" && zones.some((item) => item.code === parsed.zone)
              ? parsed.zone
              : defaultZone,
          );
          setRow(typeof parsed.row === "string" ? parsed.row : "");
          setSealed(typeof parsed.sealed === "boolean" ? parsed.sealed : false);
          setSectionOverride(
            typeof parsed.sectionOverride === "string" && parsed.sectionOverride.trim()
              ? parsed.sectionOverride
              : null,
          );
        } else {
          setInventoryZoneCode(defaultZone);
        }
      } catch {
        setInventoryZoneCode(defaultZone);
        setRow("");
        setSealed(false);
        setSectionOverride(null);
      } finally {
        setHasLoadedDiscDefaults(true);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [defaultZone, zones]);

  useEffect(() => {
    if (!hasLoadedDiscDefaults) return;
    let previousDefaults: DiscDefaults = {};
    try {
      const previous = window.localStorage.getItem(DISC_DEFAULTS_STORAGE_KEY);
      previousDefaults = previous ? (JSON.parse(previous) as DiscDefaults) : {};
    } catch {
      previousDefaults = {};
    }
    try {
      window.localStorage.setItem(
        DISC_DEFAULTS_STORAGE_KEY,
        JSON.stringify({
          ...previousDefaults,
          sealed,
          zone: inventoryZoneCode,
          row,
          sectionOverride,
        }),
      );
    } catch {
      // Keep the intake flow usable when browser storage is unavailable.
    }
  }, [hasLoadedDiscDefaults, row, sealed, sectionOverride, inventoryZoneCode]);

  useEffect(() => {
    if (!selectedRelease) return;
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = prefersReducedMotion ? "auto" : "smooth";
    confirmationRef.current?.scrollIntoView?.({ behavior, block: "start" });
  }, [selectedRelease]);

  async function searchDiscogs(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError("Enter an artist or release title to search.");
      return;
    }

    setSearching(true);
    setError("");
    setStatus("");
    setSelectedRelease(null);
    setExistingRelease(null);
    setSavedRelease(null);
    setManualMode(false);
    try {
      const response = await fetch(`/api/discogs/search?q=${encodeURIComponent(trimmedQuery)}`);
      const payload = (await response.json()) as SearchResponse;
      if (!response.ok) throw new Error(errorMessage(payload, "Discogs search failed."));
      setResults(payload.results ?? []);
      if (payload.results?.length === 0) setStatus("No matching CD releases found.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Discogs search failed.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function previewRelease(candidate: DiscogsCandidate) {
    setError("");
    setStatus("");
    setSavedRelease(null);
    setExistingRelease(null);
    try {
      const existingResponse = await fetch(
        `/api/music/releases/by-discogs/${candidate.discogsReleaseId}`,
      );
      let existing: ExistingMusicRelease | null = null;
      if (existingResponse.ok) {
        existing = (await existingResponse.json()) as ExistingMusicRelease;
      } else if (existingResponse.status !== 404) {
        const payload = await existingResponse.json();
        throw new Error(errorMessage(payload, "Could not check the saved release."));
      }

      let payload: DiscogsRelease;
      const previewResponse = await fetch(`/api/discogs/releases/${candidate.discogsReleaseId}`);
      if (previewResponse.ok) {
        payload = (await previewResponse.json()) as DiscogsRelease;
      } else if (existing) {
        payload = {
          discogsReleaseId: existing.discogsReleaseId,
          title: existing.title,
          releaseYear: existing.releaseYear,
          country: existing.country,
          formats: ["CD"],
          labels: existing.label ? [existing.label] : [],
          catalogNumber: existing.catalogNumber,
          discogsUrl: existing.discogsUrl,
          artworkUrl: null,
          artists: existing.artistCredit ? [existing.artistCredit] : [],
          label: existing.label,
          tracks: existing.tracks,
        };
      } else {
        const previewError = await previewResponse.json();
        throw new Error(errorMessage(previewError, "Could not load that release."));
      }

      setExistingRelease(existing);
      setReleaseSortTitle(existing?.sortTitle ?? suggestedSortTitle(payload.title));
      setSelectedRelease(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load that release.");
    }
  }

  async function confirmRelease() {
    if (!selectedRelease) return;
    if (existingRelease) {
      const sortTitle = releaseSortTitle.trim();
      if (!sortTitle) {
        setError("Enter a sort title for this release.");
        return;
      }
      setSaving(true);
      setError("");
      try {
        let saved = existingRelease;
        if (sortTitle !== existingRelease.sortTitle) {
          const response = await fetch(`/api/music/releases/${existingRelease.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortTitle }),
          });
          const payload = (await response.json()) as ExistingMusicRelease & { error?: string };
          if (!response.ok) {
            throw new Error(errorMessage(payload, "Could not update the sort title."));
          }
          saved = { ...existingRelease, sortTitle: payload.sortTitle };
          setExistingRelease(saved);
        }
        setSavedRelease({ id: saved.id, title: saved.title, sortTitle: saved.sortTitle });
        setStatus("Using the saved release and track list. Sort title saved.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not update the sort title.");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!releaseSortTitle.trim()) {
      setError("Enter a sort title for this release.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/music/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discogsReleaseId: selectedRelease.discogsReleaseId,
          sortTitle: releaseSortTitle.trim(),
        }),
      });
      const payload = (await response.json()) as {
        id?: string;
        title?: string;
        sortTitle?: string;
      };
      if (!response.ok || !payload.id) {
        throw new Error(errorMessage(payload, "Could not save the selected release."));
      }
      setSavedRelease({
        id: payload.id,
        title: payload.title ?? selectedRelease.title,
        sortTitle: payload.sortTitle ?? releaseSortTitle.trim(),
      });
      setStatus("Release saved. Enter this physical copy's details below.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the selected release.");
    } finally {
      setSaving(false);
    }
  }

  async function createManualRelease(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("manualTitle") ?? "").trim();
    const sortTitle = String(formData.get("manualSortTitle") ?? "").trim();
    const artistCredit = String(formData.get("manualArtist") ?? "").trim();
    const rawYear = String(formData.get("manualYear") ?? "").trim();
    const rawTracks = String(formData.get("manualTracks") ?? "");
    let releaseYear: number | null = null;
    if (rawYear) {
      const parsedYear = Number(rawYear);
      if (!Number.isInteger(parsedYear) || parsedYear < 1 || parsedYear > 9999) {
        setError("Enter a release year between 1 and 9999, or leave it blank.");
        return;
      }
      releaseYear = parsedYear;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/music/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          title,
          sortTitle,
          artistCredit: artistCredit || undefined,
          releaseYear,
          tracks: rawTracks
            .split(/\r?\n/)
            .map((track) => track.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json()) as {
        id?: string;
        title?: string;
        sortTitle?: string;
      };
      if (!response.ok || !payload.id) {
        throw new Error(errorMessage(payload, "Could not create the manual release."));
      }
      setSelectedRelease(null);
      setManualMode(false);
      setSavedRelease({
        id: payload.id,
        title: payload.title ?? title,
        sortTitle: payload.sortTitle ?? sortTitle,
      });
      setStatus("Manual release created. No Discogs data or attribution is attached.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the manual release.");
    } finally {
      setSaving(false);
    }
  }

  function openManualRelease() {
    const title = query.trim();
    setManualTitle(title);
    setManualSortTitle(suggestedSortTitle(title));
    setManualSortTitleEdited(false);
    setExistingRelease(null);
    setManualMode(true);
  }

  async function addCopy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!savedRelease) return;
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    setAddingCopy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "cd",
          music_release_id: savedRelease.id,
          zone: formData.get("zone"),
          section: formData.get("section"),
          row: formData.get("row"),
          upc_ean: formData.get("upcEan"),
          sealed: formData.get("sealed") === "true",
          availability: formData.get("availability") === "true",
          day_price: formData.get("dayPrice") || "0",
          weekend_price: formData.get("weekendPrice") || "0",
          late_class: formData.get("lateClass") || "0",
          notes: formData.get("notes"),
        }),
      });
      const payload = (await response.json()) as { inventoryCode?: string };
      if (!response.ok) throw new Error(errorMessage(payload, "Could not add the CD copy."));
      setStatus(
        `Added ${savedRelease.title} to stock${payload.inventoryCode ? ` as #${payload.inventoryCode}` : ""}.`,
      );
      setQuery("");
      setResults([]);
      setSelectedRelease(null);
      setSavedRelease(null);
      formElement.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the CD copy.");
    } finally {
      setAddingCopy(false);
    }
  }

  const displayedTracks = existingRelease?.tracks ?? selectedRelease?.tracks ?? [];

  return (
    <>
      <section className="panel section cd-release-search">
        <h2>1. Search Discogs</h2>
        <form className="inline-form cd-search-form" onSubmit={searchDiscogs}>
          <label className="search-label">
            <span>Artist or release title</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </label>
          <button type="submit" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
        {results.length > 0 ? (
          <ul className="plain-list plain-actions cd-candidate-results">
            {results.map((candidate) => (
              <li key={candidate.discogsReleaseId}>
                <span className="cd-candidate-summary">
                  <strong>{candidate.title}</strong>
                  <span className="muted cd-candidate-metadata">
                    <span>{candidate.releaseYear ?? "Year unknown"}</span>
                    {candidate.country ? <span>{candidate.country}</span> : null}
                    {candidate.formats.length > 0 ? (
                      <span title={candidate.formats.join(", ")}>
                        {truncateResultMetadata(candidate.formats.join(", "), 32)}
                      </span>
                    ) : null}
                    {candidate.labels.length > 0 ? (
                      <span title={candidate.labels.join(", ")}>
                        {truncateResultMetadata(candidate.labels.join(", "), 40)}
                      </span>
                    ) : null}
                    {candidate.catalogNumber ? <span>{candidate.catalogNumber}</span> : null}
                  </span>
                </span>
                <button type="button" onClick={() => void previewRelease(candidate)}>
                  Check edition
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {query.trim() && results.length === 0 && !searching ? (
          <button type="button" onClick={openManualRelease}>
            No match? Create manually
          </button>
        ) : null}
      </section>

      {manualMode ? (
        <section className="panel section">
          <h2>2. Create manual release</h2>
          <p className="muted">
            Use this when Discogs has no exact match. This entry will not carry Discogs attribution.
          </p>
          <form className="stack-form" onSubmit={(event) => void createManualRelease(event)}>
            <label>
              Release title
              <input
                type="text"
                name="manualTitle"
                required
                maxLength={300}
                value={manualTitle}
                onChange={(event) => {
                  const nextTitle = event.target.value;
                  setManualTitle(nextTitle);
                  if (!manualSortTitleEdited) {
                    setManualSortTitle(suggestedSortTitle(nextTitle));
                  }
                }}
              />
            </label>
            <label>
              Sort title
              <input
                type="text"
                name="manualSortTitle"
                required
                maxLength={500}
                value={manualSortTitle}
                onChange={(event) => {
                  setManualSortTitle(event.target.value);
                  setManualSortTitleEdited(true);
                }}
              />
            </label>
            <label>
              Artist / performer
              <input type="text" name="manualArtist" maxLength={500} />
            </label>
            <label>
              Release year (optional)
              <input type="number" name="manualYear" min="1" max="9999" step="1" />
            </label>
            <label>
              Track titles (optional, one per line)
              <textarea name="manualTracks" rows={6} />
            </label>
            <div className="utility-row">
              <button type="submit" disabled={saving}>
                {saving ? "Creating release…" : "Save manual release"}
              </button>
              <button type="button" onClick={() => setManualMode(false)} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {selectedRelease ? (
        <section className="panel section cd-confirmation-panel" ref={confirmationRef}>
          <h2>{existingRelease ? "2. Confirm existing release" : "2. Confirm edition details"}</h2>
          {existingRelease ? (
            <p className="muted">
              This release is already in your catalogue. Adding a copy will reuse its saved sort
              title and track list.
            </p>
          ) : null}
          <div className="cd-release-preview">
            {selectedRelease.artworkUrl ? (
              <Image
                className="cd-release-artwork"
                src={`/api/discogs/artwork?src=${encodeURIComponent(selectedRelease.artworkUrl)}`}
                width={180}
                height={180}
                unoptimized
                loading="lazy"
                alt={`${selectedRelease.title} album cover`}
              />
            ) : (
              <p className="cd-release-artwork-empty muted">No cover image available</p>
            )}
            <div>
              <p>
                <strong>{selectedRelease.title}</strong>
                {selectedRelease.releaseYear ? ` (${selectedRelease.releaseYear})` : ""}
              </p>
              <p className="muted">
                {selectedRelease.artists.join(", ") || "Artist unknown"}
                {selectedRelease.country ? ` · ${selectedRelease.country}` : ""}
                {selectedRelease.label ? ` · ${selectedRelease.label}` : ""}
                {selectedRelease.catalogNumber ? ` · ${selectedRelease.catalogNumber}` : ""}
              </p>
              <p>
                <a href={selectedRelease.discogsUrl} target="_blank" rel="noreferrer">
                  View this release on Discogs
                </a>
              </p>
            </div>
          </div>
          <label className="cd-sort-title-field">
            Sort title
            <input
              type="text"
              required
              maxLength={500}
              value={releaseSortTitle}
              onChange={(event) => setReleaseSortTitle(event.target.value)}
              disabled={Boolean(savedRelease)}
            />
          </label>
          <h3>Track listing preview</h3>
          {displayedTracks.length > 0 ? (
            <ol className="cd-track-list">
              {displayedTracks.map((track) =>
                track.entryType === "heading" ? (
                  <li className="cd-track-heading" key={track.sequenceNo}>
                    {track.title}
                  </li>
                ) : (
                  <li className="cd-track-row" key={track.sequenceNo}>
                    <span className="cd-track-name">
                      {track.position ? (
                        <span className="cd-track-position">{track.position}</span>
                      ) : null}
                      <span>{track.title}</span>
                    </span>
                    {track.durationSeconds !== null ? (
                      <span className="cd-track-duration">
                        {formatDuration(track.durationSeconds)}
                      </span>
                    ) : null}
                  </li>
                ),
              )}
            </ol>
          ) : (
            <p className="muted">No track listing is available.</p>
          )}
          {!savedRelease ? (
            <button type="button" onClick={() => void confirmRelease()} disabled={saving}>
              {saving
                ? existingRelease
                  ? "Saving sort title…"
                  : "Saving release…"
                : existingRelease
                  ? releaseSortTitle.trim() === existingRelease.sortTitle
                    ? "Use existing release"
                    : "Save sort title and continue"
                  : "Save release and continue"}
            </button>
          ) : null}
        </section>
      ) : null}

      {savedRelease ? (
        <section className="panel section">
          <h2>3. Add physical copy</h2>
          <form className="stack-form" onSubmit={(event) => void addCopy(event)}>
            <fieldset>
              <legend>Zone</legend>
              <div className="button-choice-group">
                {zones.map((zone) => (
                  <label className="choice-button" key={zone.code}>
                    <input
                      type="radio"
                      name="zone"
                      value={zone.code}
                      checked={zone.code === inventoryZoneCode}
                      onChange={() => setInventoryZoneCode(zone.code)}
                    />
                    <span>{formatZoneLabel(zone.code, zones)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              <span className="form-label-row">
                <span>Section</span>
                {sectionOverride !== null ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setSectionOverride(null)}
                  >
                    Use title initial ({defaultSectionFromRelease})
                  </button>
                ) : null}
              </span>
              <input
                type="text"
                name="section"
                aria-label="Section"
                required
                maxLength={2}
                value={sectionValue}
                onChange={(event) =>
                  setSectionOverride(event.target.value.toUpperCase().slice(0, 2))
                }
              />
            </label>
            <label>
              Row (optional)
              <input
                type="text"
                name="row"
                maxLength={2}
                value={row}
                onChange={(event) => setRow(event.target.value.toUpperCase().slice(0, 2))}
              />
            </label>
            <UpcEanInput />
            <div className="inline-split">
              <label className="checkbox-row">
                <input type="checkbox" name="availability" value="true" defaultChecked />
                <span>Available?</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="sealed"
                  value="true"
                  checked={sealed}
                  onChange={(event) => setSealed(event.target.checked)}
                />
                <span>Sealed?</span>
              </label>
            </div>
            <div className="price-field-row">
              <label>
                Day price
                <input type="number" name="dayPrice" min="0" step="0.01" defaultValue="0" />
              </label>
              <label>
                Weekend price
                <input type="number" name="weekendPrice" min="0" step="0.01" defaultValue="0" />
              </label>
              <label>
                Late class
                <input type="number" name="lateClass" min="0" step="1" defaultValue="0" />
              </label>
            </div>
            <label>
              Notes
              <textarea name="notes" rows={3} />
            </label>
            <button type="submit" disabled={addingCopy}>
              {addingCopy ? "Adding copy…" : "Add CD to stock"}
            </button>
          </form>
        </section>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="muted" role="status">
          {status}
        </p>
      ) : null}
    </>
  );
}
