export type DiscFormat = "dvd" | "blu-ray" | "4k-uhd";
export type MediaType = "movie" | "series";

export type Movie = {
  id: string;
  tmdbId: string;
  imdbId?: string;
  imdbRating?: number;
  mediaType: MediaType;
  title: string;
  sortTitle: string;
  overview: string;
  releaseDate: string;
  posterUrl?: string | null;
  posterColor: string;
  genres: string[];
  director: string;
  cast: string[];
  featured?: boolean;
  hideFromHomepage?: boolean;
};

export type LinkedTitle = {
  id: string;
  title: string;
  sortTitle: string;
  mediaType: MediaType;
  releaseDate: string;
  seasonStart?: number;
  seasonEnd?: number;
  episodeStart?: number;
  episodeEnd?: number;
};

export type TitleCollection = {
  id: string;
  name: string;
  posterUrl?: string | null;
};

export type InventoryItem = {
  id: string;
  inventoryCode: string;
  format: DiscFormat;
  availability: boolean;
  reviewed: boolean;
  sealed: boolean;
  zone: string;
  section: string;
  row: string;
  locationCode: string;
  linkedTitles: LinkedTitle[];
  notes?: string;
  lastRentedAt?: string;
  dayPrice: number;
  weekendPrice: number;
  lateClass: number;
  updatedAt?: string;
};

export type StockViewDisc = InventoryItem & {
  collectionName?: string;
  isPrimary: boolean;
  sortLabel: string;
  sortAnchor: string;
  sortSequence: number;
};

export type StockViewSection = {
  section: string;
  items: StockViewDisc[];
};

export type StockViewPage = {
  items: StockViewDisc[];
  totalCount: number;
};

export type MovieWithInventory = Movie & {
  inventoryItems: InventoryItem[];
  availableCount: number;
  totalCopies: number;
  collection?: TitleCollection;
  collectionTitles: LinkedTitle[];
};
