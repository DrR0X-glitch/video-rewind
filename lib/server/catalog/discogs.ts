import "server-only";

import packageMetadata from "@/package.json";

const apiBaseUrl = "https://api.discogs.com";
const requestTimeoutMs = 10_000;

type DiscogsPaginationResponse = {
  page?: unknown;
  per_page?: unknown;
  items?: unknown;
};

type DiscogsSearchResultResponse = {
  id?: unknown;
  title?: unknown;
  year?: unknown;
  country?: unknown;
  format?: unknown;
  label?: unknown;
  catno?: unknown;
  uri?: unknown;
};

type DiscogsSearchResponse = {
  pagination?: DiscogsPaginationResponse;
  results?: unknown;
};

type DiscogsReleaseResponse = {
  id?: unknown;
  title?: unknown;
  formats?: unknown;
  year?: unknown;
  country?: unknown;
  uri?: unknown;
  artists?: unknown;
  labels?: unknown;
  identifiers?: unknown;
  images?: unknown;
  tracklist?: unknown;
};

type DiscogsTrackResponse = {
  position?: unknown;
  title?: unknown;
  duration?: unknown;
  type_?: unknown;
  sub_tracks?: unknown;
};

type DiscogsIdentifierResponse = {
  type?: unknown;
  value?: unknown;
};

export type DiscogsRateLimitState = {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  retryAfterMs: number | null;
};

export type DiscogsApiErrorCode =
  | "configuration"
  | "invalid_request"
  | "not_found"
  | "unsupported_format"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "timeout"
  | "network"
  | "upstream"
  | "invalid_response";

export class DiscogsApiError extends Error {
  readonly code: DiscogsApiErrorCode;
  readonly status: number | null;
  readonly rateLimit: DiscogsRateLimitState | null;

  constructor(
    code: DiscogsApiErrorCode,
    message: string,
    options: { status?: number; rateLimit?: DiscogsRateLimitState } = {},
  ) {
    super(message);
    this.name = "DiscogsApiError";
    this.code = code;
    this.status = options.status ?? null;
    this.rateLimit = options.rateLimit ?? null;
  }
}

export type DiscogsReleaseCandidate = {
  discogsReleaseId: number;
  title: string;
  releaseYear: number | null;
  country: string | null;
  formats: string[];
  labels: string[];
  catalogNumber: string | null;
  discogsUrl: string;
};

export type DiscogsTrackDraft = {
  sequenceNo: number;
  position: string;
  title: string;
  entryType: "track" | "heading";
  durationSeconds: number | null;
  parentSequenceNo: number | null;
};

export type DiscogsReleaseDraft = {
  discogsReleaseId: number;
  title: string;
  artists: string[];
  releaseYear: number | null;
  country: string | null;
  label: string | null;
  catalogNumber: string | null;
  barcode: string | null;
  artworkUrl: string | null;
  discogsUrl: string;
  tracks: DiscogsTrackDraft[];
};

export type DiscogsSearchPage = {
  results: DiscogsReleaseCandidate[];
  page: number;
  perPage: number;
  totalResults: number;
  rateLimit: DiscogsRateLimitState;
};

type DiscogsConfiguration = {
  userAgent: string;
  consumerKey: string;
  consumerSecret: string;
};

type DiscogsJsonResponse<T> = {
  payload: T;
  rateLimit: DiscogsRateLimitState;
};

function getDiscogsConfiguration(): DiscogsConfiguration {
  const userAgent =
    process.env.DISCOGS_USER_AGENT?.trim() || `VideoRewind/${packageMetadata.version}`;
  const consumerKey = process.env.DISCOGS_CONSUMER_KEY?.trim() ?? "";
  const consumerSecret = process.env.DISCOGS_CONSUMER_SECRET?.trim() ?? "";

  if (/\r|\n/.test(userAgent)) {
    throw new DiscogsApiError("configuration", "DISCOGS_USER_AGENT is invalid");
  }

  if (!consumerKey || !consumerSecret) {
    throw new DiscogsApiError(
      "configuration",
      "DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET must both be configured",
    );
  }

  return { userAgent, consumerKey, consumerSecret };
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function readRateLimit(headers: Headers): DiscogsRateLimitState {
  return {
    limit: parsePositiveInteger(headers.get("x-discogs-ratelimit")),
    used: parseNonNegativeInteger(headers.get("x-discogs-ratelimit-used")),
    remaining: parseNonNegativeInteger(headers.get("x-discogs-ratelimit-remaining")),
    retryAfterMs: parseRetryAfter(headers.get("retry-after")),
  };
}

function parseDiscogsError(response: Response, rateLimit: DiscogsRateLimitState): DiscogsApiError {
  if (response.status === 404) {
    return new DiscogsApiError("not_found", "Discogs release not found", {
      status: response.status,
      rateLimit,
    });
  }

  if (response.status === 401) {
    return new DiscogsApiError("unauthorized", "Discogs rejected the configured credentials", {
      status: response.status,
      rateLimit,
    });
  }

  if (response.status === 403) {
    return new DiscogsApiError("forbidden", "Discogs denied the request", {
      status: response.status,
      rateLimit,
    });
  }

  if (response.status === 429) {
    return new DiscogsApiError("rate_limited", "Discogs rate limit reached", {
      status: response.status,
      rateLimit,
    });
  }

  return new DiscogsApiError("upstream", "Discogs request failed", {
    status: response.status,
    rateLimit,
  });
}

async function requestDiscogsJson<T>(
  path: string,
  params?: URLSearchParams,
): Promise<DiscogsJsonResponse<T>> {
  const config = getDiscogsConfiguration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const url = new URL(path, apiBaseUrl);
  if (params) {
    url.search = params.toString();
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.discogs.v2.discogs+json",
        "User-Agent": config.userAgent,
        Authorization: `Discogs key=${config.consumerKey}, secret=${config.consumerSecret}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const rateLimit = readRateLimit(response.headers);
    if (!response.ok) {
      throw parseDiscogsError(response, rateLimit);
    }

    try {
      return { payload: (await response.json()) as T, rateLimit };
    } catch (error) {
      if (controller.signal.aborted) {
        throw error;
      }

      throw new DiscogsApiError("invalid_response", "Discogs returned invalid JSON", {
        status: response.status,
        rateLimit,
      });
    }
  } catch (error) {
    if (error instanceof DiscogsApiError) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new DiscogsApiError("timeout", "Discogs request timed out");
    }

    throw new DiscogsApiError("network", "Could not reach Discogs");
  } finally {
    clearTimeout(timeout);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(asString).filter((entry): entry is string => entry !== null);
}

function mapYear(value: unknown): number | null {
  const year = parsePositiveInteger(value);
  return year !== null && year <= 9999 ? year : null;
}

function getDiscogsReleaseUrl(value: unknown, releaseId: number): string {
  const uri = asString(value);
  if (uri) {
    try {
      const parsed = new URL(uri);
      if (
        parsed.protocol === "https:" &&
        (parsed.hostname === "www.discogs.com" || parsed.hostname === "discogs.com") &&
        parsed.pathname.startsWith("/release/")
      ) {
        return parsed.toString();
      }
    } catch {
      // Use the canonical URL below for malformed or unexpected upstream values.
    }
  }

  return `https://www.discogs.com/release/${releaseId}`;
}

function mapSearchCandidate(value: unknown): DiscogsReleaseCandidate | null {
  const result = asRecord(value) as DiscogsSearchResultResponse | null;
  const id = parsePositiveInteger(result?.id);
  const title = asString(result?.title);
  if (!result || !id || !title) {
    return null;
  }

  return {
    discogsReleaseId: id,
    title,
    releaseYear: mapYear(result.year),
    country: asString(result.country),
    formats: asStringArray(result.format),
    labels: asStringArray(result.label),
    catalogNumber: asString(result.catno),
    discogsUrl: getDiscogsReleaseUrl(result.uri, id),
  };
}

function parseDurationSeconds(value: unknown): number | null {
  const duration = asString(value);
  if (!duration) {
    return null;
  }

  const parts = duration.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isSafeInteger(part))) {
    return null;
  }

  const seconds = numbers[numbers.length - 1];
  const minutes = numbers[numbers.length - 2];
  const hours = numbers.length === 3 ? numbers[0] : 0;
  if (seconds >= 60 || minutes >= 60) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function mapTracklist(value: unknown): DiscogsTrackDraft[] {
  const tracks: DiscogsTrackDraft[] = [];

  function appendEntries(entries: unknown, parentSequenceNo: number | null) {
    if (!Array.isArray(entries)) {
      return;
    }

    for (const entryValue of entries) {
      const entry = asRecord(entryValue) as DiscogsTrackResponse | null;
      if (!entry) {
        continue;
      }

      const title = asString(entry.title);
      if (!title) {
        continue;
      }

      const subTracks = Array.isArray(entry.sub_tracks) ? entry.sub_tracks : [];
      const sequenceNo = tracks.length + 1;
      const entryType =
        entry.type_ === "heading" || entry.type_ === "index" || subTracks.length > 0
          ? "heading"
          : "track";

      tracks.push({
        sequenceNo,
        position: asString(entry.position) ?? "",
        title,
        entryType,
        durationSeconds: entryType === "track" ? parseDurationSeconds(entry.duration) : null,
        parentSequenceNo,
      });

      if (subTracks.length > 0) {
        appendEntries(subTracks, sequenceNo);
      }
    }
  }

  appendEntries(value, null);
  return tracks;
}

function mapDiscogsRelease(value: unknown): DiscogsReleaseDraft {
  const release = asRecord(value) as DiscogsReleaseResponse | null;
  const id = parsePositiveInteger(release?.id);
  const title = asString(release?.title);
  if (!release || !id || !title) {
    throw new DiscogsApiError(
      "invalid_response",
      "Discogs release response is missing its id or title",
    );
  }

  const hasCdFormat =
    Array.isArray(release.formats) &&
    release.formats.some((format) => asString(asRecord(format)?.name)?.toLowerCase() === "cd");
  if (!hasCdFormat) {
    throw new DiscogsApiError("unsupported_format", "Discogs release is not a CD release");
  }

  const artists = Array.isArray(release.artists)
    ? release.artists
        .map((artistValue) => asString(asRecord(artistValue)?.name))
        .filter((artist): artist is string => artist !== null)
    : [];
  const label = Array.isArray(release.labels) ? asString(asRecord(release.labels[0])?.name) : null;
  const catalogNumber = Array.isArray(release.labels)
    ? asString(asRecord(release.labels[0])?.catno)
    : null;
  const identifiers = Array.isArray(release.identifiers) ? release.identifiers : [];
  const barcode = identifiers
    .map((identifier) => asRecord(identifier) as DiscogsIdentifierResponse | null)
    .find((identifier) => asString(identifier?.type)?.toLowerCase() === "barcode");
  const artwork = Array.isArray(release.images)
    ? (release.images
        .map((image) => {
          const record = asRecord(image);
          const candidate = asString(record?.uri) ?? asString(record?.uri150);
          if (!candidate) return null;
          try {
            const url = new URL(candidate);
            return url.protocol === "https:" &&
              ["i.discogs.com", "img.discogs.com"].includes(url.hostname)
              ? url.toString()
              : null;
          } catch {
            return null;
          }
        })
        .find((url): url is string => url !== null) ?? null)
    : null;

  return {
    discogsReleaseId: id,
    title,
    artists,
    releaseYear: mapYear(release.year),
    country: asString(release.country),
    label,
    catalogNumber,
    barcode: asString(barcode?.value),
    artworkUrl: artwork,
    discogsUrl: getDiscogsReleaseUrl(release.uri, id),
    tracks: mapTracklist(release.tracklist),
  };
}

function normalizeSearchInput(input: {
  query?: string;
  barcode?: string;
  page?: number;
  perPage?: number;
}) {
  const query = input.query?.trim() ?? "";
  const barcode = input.barcode?.trim() ?? "";

  if ((!query && !barcode) || (query && barcode)) {
    throw new DiscogsApiError("invalid_request", "Provide either a search query or a barcode");
  }

  const page = input.page ?? 1;
  const perPage = input.perPage ?? 20;
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    perPage > 100
  ) {
    throw new DiscogsApiError("invalid_request", "Discogs page and page size are invalid");
  }

  return { query, barcode, page, perPage };
}

export async function searchDiscogsReleaseCandidates(input: {
  query?: string;
  barcode?: string;
  page?: number;
  perPage?: number;
}): Promise<DiscogsSearchPage> {
  const normalized = normalizeSearchInput(input);
  const params = new URLSearchParams({
    type: "release",
    format: "CD",
    page: normalized.page.toString(),
    per_page: normalized.perPage.toString(),
  });
  params.set(normalized.barcode ? "barcode" : "q", normalized.barcode || normalized.query);

  const response = await requestDiscogsJson<DiscogsSearchResponse>("/database/search", params);
  const pagination = asRecord(response.payload.pagination) as DiscogsPaginationResponse | null;
  const rawResults = Array.isArray(response.payload.results) ? response.payload.results : [];

  return {
    results: rawResults
      .map(mapSearchCandidate)
      .filter((candidate): candidate is DiscogsReleaseCandidate => candidate !== null),
    page: parsePositiveInteger(pagination?.page) ?? normalized.page,
    perPage: parsePositiveInteger(pagination?.per_page) ?? normalized.perPage,
    totalResults: parseNonNegativeInteger(pagination?.items) ?? 0,
    rateLimit: response.rateLimit,
  };
}

export async function fetchDiscogsReleaseDraft(
  releaseId: number | string,
): Promise<DiscogsReleaseDraft> {
  const normalizedId = typeof releaseId === "number" ? releaseId.toString() : releaseId.trim();
  if (!/^\d+$/.test(normalizedId) || Number(normalizedId) < 1) {
    throw new DiscogsApiError("invalid_request", "Discogs release id must be a positive integer");
  }

  const response = await requestDiscogsJson<DiscogsReleaseResponse>(`/releases/${normalizedId}`);
  return mapDiscogsRelease(response.payload);
}
