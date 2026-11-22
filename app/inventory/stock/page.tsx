import Link from "next/link";

import { applyBulkStockAction } from "@/app/inventory/stock/actions";
import { StockBulkControls } from "@/components/stock-bulk-controls";
import { StockTableBody } from "@/components/stock-table-body";
import { FORMAT_OPTIONS, ZONE_OPTIONS, formatZoneLabel } from "@/lib/constants";
import { listStockDiscs } from "@/lib/data";
import { formatDiscFormat } from "@/lib/format";

type StockPageProps = {
  searchParams: Promise<{
    availability?: string | string[];
    edited?: string;
    dir?: string;
    format?: string | string[];
    page?: string;
    preset?: string;
    primary?: string;
    q?: string;
    row?: string | string[];
    sealed?: string | string[];
    showAll?: string;
    sort?: string;
    section?: string | string[];
    zone?: string | string[];
  }>;
};

const STOCK_PAGE_SIZE = 50;
export const dynamic = "force-dynamic";

const presetOptions = [
  { id: "all", label: "All Discs" },
  { id: "wall", label: "Wall" },
] as const;

const availabilityOptions = [
  { value: "all", label: "All discs" },
  { value: "available", label: "Available" },
  { value: "out", label: "Out" },
] as const;

const editedOptions = [
  { value: "all", label: "Any time" },
  { value: "day", label: "Last day" },
  { value: "week", label: "Last week" },
  { value: "month", label: "Last month" },
] as const;

const sealedOptions = [
  { value: "all", label: "All discs" },
  { value: "true", label: "Sealed" },
  { value: "false", label: "Open" },
] as const;

const primaryOptions = [
  { value: "all", label: "All discs" },
  { value: "primary", label: "Primary" },
  { value: "duplicate", label: "Duplicate" },
] as const;

const sortOptions = new Set([
  "disc",
  "format",
  "primary",
  "titles",
  "order",
  "availability",
  "updated",
  "location",
  "sealed",
]);

export default async function InventoryStockPage({ searchParams }: StockPageProps) {
  const params = await searchParams;
  const selectedFormats = getSelectedValues(params.format, FORMAT_OPTIONS);
  const selectedZones = getSelectedValues(params.zone, ZONE_OPTIONS);
  const selectedSealedStates = getSelectedValues(params.sealed, ["true", "false"] as const);
  const selectedPreset = presetOptions.some((option) => option.id === params.preset)
    ? (params.preset ?? "all")
    : "all";
  const selectedAvailability =
    typeof params.availability === "string" &&
    availabilityOptions.some((option) => option.value === params.availability)
      ? params.availability
      : "all";
  const selectedEdited = editedOptions.some((option) => option.value === params.edited)
    ? (params.edited ?? "all")
    : "all";
  const selectedPrimary =
    typeof params.primary === "string" &&
    primaryOptions.some((option) => option.value === params.primary)
      ? params.primary
      : "all";
  const selectedSort = sortOptions.has(params.sort ?? "") ? (params.sort ?? "updated") : "updated";
  const selectedDir = params.dir === "asc" ? "asc" : "desc";
  const showAll = params.showAll === "true";
  const selectedPage =
    typeof params.page === "string" &&
    /^\d+$/.test(params.page) &&
    Number.parseInt(params.page, 10) > 0
      ? Number.parseInt(params.page, 10)
      : 1;
  const query = params.q?.trim() ?? "";
  const section = normalizeLocationFilter(params.section);
  const row = normalizeLocationFilter(params.row);
  const presetHrefState = {
    availability: selectedAvailability,
    edited: selectedEdited,
    formats: selectedFormats,
    primary: selectedPrimary,
    zones: selectedZones,
    sealedStates: selectedSealedStates,
    sort: selectedSort,
    dir: selectedDir,
    q: query,
    section,
    row,
  };

  const stockPage = await listStockDiscs({
    preset: selectedPreset,
    q: query || undefined,
    section: section || undefined,
    row: row || undefined,
    availability: selectedAvailability,
    edited: selectedEdited,
    formats: selectedFormats,
    primary: selectedPrimary,
    zones: selectedZones,
    sealedStates: selectedSealedStates,
    reviewedState: "true",
    sort: selectedSort,
    dir: selectedDir,
    page: showAll ? 1 : selectedPage,
    pageSize: showAll ? 100000 : STOCK_PAGE_SIZE,
  });
  const items = stockPage.items;
  const totalCount = stockPage.totalCount;
  const allMatchingItems =
    showAll || stockPage.items.length >= stockPage.totalCount
      ? stockPage.items
      : (
          await listStockDiscs({
            preset: selectedPreset,
            q: query || undefined,
            section: section || undefined,
            row: row || undefined,
            availability: selectedAvailability,
            edited: selectedEdited,
            formats: selectedFormats,
            primary: selectedPrimary,
            zones: selectedZones,
            sealedStates: selectedSealedStates,
            reviewedState: "true",
            sort: selectedSort,
            dir: selectedDir,
            page: 1,
            pageSize: 100000,
          })
        ).items;
  const allMatchingIds = allMatchingItems.map((item) => item.id);
  const totalPages = showAll ? 1 : Math.max(1, Math.ceil(totalCount / STOCK_PAGE_SIZE));
  const currentPage = showAll ? 1 : Math.min(selectedPage, totalPages);
  const pageStart =
    totalCount === 0 ? 0 : (currentPage - 1) * (showAll ? totalCount || 1 : STOCK_PAGE_SIZE) + 1;
  const pageEnd = totalCount === 0 ? 0 : pageStart + items.length - 1;

  const bulkFormId = "stock-bulk-form";
  const filterFormId = "stock-filter-form";
  const currentStockHref = buildStockHref({
    availability: selectedAvailability,
    edited: selectedEdited,
    primary: selectedPrimary,
    sealedStates: selectedSealedStates,
    reviewedState: "true",
    dir: selectedDir,
    formats: selectedFormats,
    page: currentPage,
    showAll,
    q: query,
    section,
    row,
    sort: selectedSort,
    zones: selectedZones,
  });
  const previousPageHref =
    currentPage > 1
      ? buildStockHref({
          availability: selectedAvailability,
          edited: selectedEdited,
          primary: selectedPrimary,
          sealedStates: selectedSealedStates,
          reviewedState: "true",
          dir: selectedDir,
          formats: selectedFormats,
          page: currentPage - 1,
          showAll: false,
          q: query,
          section,
          row,
          sort: selectedSort,
          zones: selectedZones,
        })
      : null;
  const nextPageHref =
    currentPage < totalPages
      ? buildStockHref({
          availability: selectedAvailability,
          edited: selectedEdited,
          primary: selectedPrimary,
          sealedStates: selectedSealedStates,
          reviewedState: "true",
          dir: selectedDir,
          formats: selectedFormats,
          page: currentPage + 1,
          showAll: false,
          q: query,
          section,
          row,
          sort: selectedSort,
          zones: selectedZones,
        })
      : null;

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>Stock View</h1>
          </div>
          <Link href="/inventory">Back to Inventory</Link>
        </div>
        <div className="preset-strip">
          {presetOptions.map((preset) => (
            <Link
              key={preset.id}
              href={buildStockHref(applyPresetToFilters(preset.id, presetHrefState))}
              className={
                selectedPreset === preset.id && preset.id !== "all"
                  ? "preset-link preset-link-active"
                  : "preset-link"
              }
            >
              {preset.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <section className="panel section">
          <form id={filterFormId} className="stock-filter-bar">
            <input type="hidden" name="sort" value={selectedSort} />
            <input type="hidden" name="dir" value={selectedDir} />
            <label className="search-label bulk-action-field">
              <span>Search</span>
              <input
                type="text"
                name="q"
                defaultValue={query}
                placeholder="Discs, titles, location, notes"
              />
            </label>
            <label className="search-label stock-location-filter">
              <span>Section</span>
              <input
                type="text"
                name="section"
                defaultValue={section}
                placeholder="A1"
                maxLength={2}
                autoComplete="off"
              />
            </label>
            <label className="search-label stock-location-filter">
              <span>Row</span>
              <input
                type="text"
                name="row"
                defaultValue={row}
                placeholder="03"
                maxLength={2}
                autoComplete="off"
              />
            </label>
            <SingleSelectDropdown
              label="Last Edited"
              name="edited"
              selectedValue={selectedEdited}
              options={editedOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
            <MultiSelectDropdown
              label="Format"
              name="format"
              selectedValues={selectedFormats}
              options={FORMAT_OPTIONS.map((format) => ({
                value: format,
                label: formatDiscFormat(format),
              }))}
            />
            <MultiSelectDropdown
              label="Sealed"
              name="sealed"
              selectedValues={selectedSealedStates}
              options={sealedOptions
                .filter((option) => option.value !== "all")
                .map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
            />
            <MultiSelectDropdown
              label="Zone"
              name="zone"
              selectedValues={selectedZones}
              options={ZONE_OPTIONS.map((zone) => ({
                value: zone,
                label: formatZoneLabel(zone),
              }))}
            />
            <SingleSelectDropdown
              label="Primary"
              name="primary"
              selectedValue={selectedPrimary}
              options={primaryOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
            <button type="submit">Filter</button>
          </form>
        </section>

        <div className="stock-table-shell">
          <form id={bulkFormId} action={applyBulkStockAction} className="stack-form">
            <input type="hidden" name="q" value={query} />
            <input type="hidden" name="section" value={section} />
            <input type="hidden" name="row" value={row} />
            <input type="hidden" name="availabilityFilter" value={selectedAvailability} />
            <input type="hidden" name="edited" value={selectedEdited} />
            <input type="hidden" name="primary" value={selectedPrimary} />
            <input type="hidden" name="showAll" value={showAll ? "true" : "false"} />
            <input type="hidden" name="sort" value={selectedSort} />
            <input type="hidden" name="dir" value={selectedDir} />
            <input type="hidden" name="page" value={currentPage.toString()} />
            {selectedFormats.map((format) => (
              <input key={format} type="hidden" name="format" value={format} />
            ))}
            {selectedZones.map((zone) => (
              <input key={zone} type="hidden" name="zone" value={zone} />
            ))}
            {selectedSealedStates.map((sealed) => (
              <input key={sealed} type="hidden" name="sealed" value={sealed} />
            ))}
            <div className="section-heading stock-results-bar">
              <p className="muted utility-row">
                {totalCount === 0
                  ? "Showing 0 entries"
                  : `Showing ${pageStart}-${pageEnd} of ${totalCount}`}
              </p>
            </div>
            <table>
              <thead>
                <tr>
                  <th className="selection-column">Select</th>
                  <th>{renderSortLink("Disc", "disc", selectedSort, selectedDir, params)}</th>
                  <th>{renderSortLink("Format", "format", selectedSort, selectedDir, params)}</th>
                  <th>{renderSortLink("Titles", "order", selectedSort, selectedDir, params)}</th>
                  <th>{renderSortLink("Primary", "primary", selectedSort, selectedDir, params)}</th>
                  <th>{renderSortLink("Sealed", "sealed", selectedSort, selectedDir, params)}</th>
                  <th>
                    {renderSortLink("Last Edited", "updated", selectedSort, selectedDir, params)}
                  </th>
                  <th>
                    {renderSortLink("Location", "location", selectedSort, selectedDir, params)}
                  </th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <StockTableBody
                bulkFormId={bulkFormId}
                currentStockHref={currentStockHref}
                items={items}
                showAvailabilityColumn={false}
                showPrimaryColumn
              />
            </table>
            <div className="section stock-table-footer">
              <StockBulkControls allMatchingIds={allMatchingIds} />
              {totalPages > 1 || showAll ? (
                <div className="header-actions stock-pagination">
                  {showAll ? (
                    <Link
                      href={buildStockHref({
                        availability: selectedAvailability,
                        edited: selectedEdited,
                        primary: selectedPrimary,
                        sealedStates: selectedSealedStates,
                        reviewedState: "true",
                        dir: selectedDir,
                        formats: selectedFormats,
                        page: 1,
                        q: query,
                        section,
                        row,
                        sort: selectedSort,
                        zones: selectedZones,
                      })}
                    >
                      Paginate
                    </Link>
                  ) : (
                    <>
                      {previousPageHref ? (
                        <Link href={previousPageHref}>Previous</Link>
                      ) : (
                        <span className="muted">Previous</span>
                      )}
                      <span className="muted">
                        Page {currentPage} of {totalPages}
                      </span>
                      {nextPageHref ? (
                        <Link href={nextPageHref}>Next</Link>
                      ) : (
                        <span className="muted">Next</span>
                      )}
                      <Link
                        href={buildStockHref({
                          availability: selectedAvailability,
                          edited: selectedEdited,
                          primary: selectedPrimary,
                          sealedStates: selectedSealedStates,
                          reviewedState: "true",
                          dir: selectedDir,
                          formats: selectedFormats,
                          page: 1,
                          showAll: true,
                          q: query,
                          section,
                          row,
                          sort: selectedSort,
                          zones: selectedZones,
                        })}
                      >
                        Show All
                      </Link>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

function renderSortLink(
  label: string,
  column: string,
  selectedSort: string,
  selectedDir: string,
  params: Awaited<StockPageProps["searchParams"]>,
) {
  const nextDir = selectedSort === column && selectedDir === "asc" ? "desc" : "asc";
  const href = buildStockHref({
    availability: typeof params.availability === "string" ? params.availability : "all",
    edited: editedOptions.some((option) => option.value === params.edited)
      ? (params.edited ?? "all")
      : "all",
    primary:
      typeof params.primary === "string" &&
      primaryOptions.some((option) => option.value === params.primary)
        ? params.primary
        : "all",
    sealedStates: getSelectedValues(params.sealed, ["true", "false"] as const),
    dir: nextDir,
    formats: getSelectedValues(params.format, FORMAT_OPTIONS),
    q: params.q ?? "",
    section: normalizeLocationFilter(params.section),
    row: normalizeLocationFilter(params.row),
    sort: column,
    zones: getSelectedValues(params.zone, ZONE_OPTIONS),
  });

  return (
    <Link href={href} className="table-sort-link">
      {label}
      {selectedSort === column ? (selectedDir === "asc" ? " ↑" : " ↓") : ""}
    </Link>
  );
}

function buildStockHref(input: {
  availability?: string;
  edited?: string;
  primary?: string;
  sealedStates?: string[];
  dir?: string;
  formats?: string[];
  page?: number;
  showAll?: boolean;
  q?: string;
  section?: string;
  row?: string;
  reviewedState?: string;
  sort?: string;
  zones?: string[];
}) {
  const params = new URLSearchParams();

  if (input.q && input.q.trim()) params.set("q", input.q.trim());
  if (input.section && input.section.trim())
    params.set("section", input.section.trim().toUpperCase());
  if (input.row && input.row.trim()) params.set("row", input.row.trim().toUpperCase());
  if (input.availability && input.availability !== "all")
    params.set("availability", input.availability);
  if (input.edited && input.edited !== "all") params.set("edited", input.edited);
  if (input.primary && input.primary !== "all") params.set("primary", input.primary);
  for (const format of input.formats ?? []) params.append("format", format);
  for (const zone of input.zones ?? []) params.append("zone", zone);
  for (const sealed of input.sealedStates ?? []) params.append("sealed", sealed);
  if (input.sort && input.sort !== "updated") params.set("sort", input.sort);
  if (input.dir && input.dir !== "desc") params.set("dir", input.dir);
  if (input.showAll) params.set("showAll", "true");
  if (input.page && input.page > 1) params.set("page", input.page.toString());

  const query = params.toString();
  return query ? `/inventory/stock?${query}` : "/inventory/stock";
}

function getSelectedValues<T extends string>(
  input: string | string[] | undefined,
  allowed: readonly T[],
) {
  const values = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];

  return Array.from(new Set(values.filter((value): value is T => allowed.includes(value as T))));
}

function MultiSelectDropdown({
  label,
  name,
  options,
  selectedValues,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  selectedValues: string[];
}) {
  const selectedLabels = options
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label);

  const summary =
    selectedLabels.length === 0
      ? `All ${label.toLowerCase()}`
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} selected`;

  return (
    <div className="search-label filter-dropdown-field">
      <span>{label}</span>
      <details className="filter-dropdown">
        <summary className="filter-dropdown-summary">
          <span className="filter-dropdown-value">{summary}</span>
        </summary>
        <div className="filter-dropdown-menu">
          <div className="filter-checkboxes">
            {options.map((option) => (
              <label key={option.value} className="checkbox-chip">
                <input
                  type="checkbox"
                  name={name}
                  value={option.value}
                  defaultChecked={selectedValues.includes(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

function SingleSelectDropdown({
  label,
  name,
  options,
  selectedValue,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  selectedValue: string;
}) {
  const selectedLabel =
    options.find((option) => option.value === selectedValue)?.label ?? options[0]?.label ?? "";

  return (
    <div className="search-label filter-dropdown-field">
      <span>{label}</span>
      <details className="filter-dropdown filter-dropdown-single">
        <summary className="filter-dropdown-summary">
          <span className="filter-dropdown-value">{selectedLabel}</span>
        </summary>
        <div className="filter-dropdown-menu">
          <div className="filter-checkboxes">
            {options.map((option) => (
              <label key={option.value} className="checkbox-chip">
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  defaultChecked={selectedValue === option.value}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

function applyPresetToFilters(
  preset: (typeof presetOptions)[number]["id"],
  current: {
    availability: string;
    edited: string;
    formats: string[];
    primary: string;
    zones: string[];
    sealedStates: string[];
    sort: string;
    dir: string;
    q: string;
    section: string;
    row: string;
  },
) {
  if (preset === "all") {
    return {
      availability: "all",
      edited: "all",
      formats: [],
      primary: "all",
      zones: [],
      sealedStates: [],
      sort: current.sort,
      dir: current.dir,
      q: current.q,
      section: current.section,
      row: current.row,
    };
  }

  if (preset === "wall") {
    return {
      ...current,
      availability: "all",
      edited: "all",
      formats: [],
      primary: "primary",
      zones: ["W"],
      sealedStates: [],
      sort: "location",
      dir: "asc",
      section: current.section,
      row: current.row,
    };
  }

  return current;
}

function normalizeLocationFilter(value?: string | string[]) {
  const selectedValue = Array.isArray(value) ? value[0] : value;
  return typeof selectedValue === "string" ? selectedValue.trim().toUpperCase().slice(0, 2) : "";
}
