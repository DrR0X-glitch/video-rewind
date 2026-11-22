"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ZONE_OPTIONS, formatZoneLabel } from "@/lib/constants";

type StockBulkControlsProps = {
  allMatchingIds: string[];
};

export function StockBulkControls({ allMatchingIds }: StockBulkControlsProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [applyAvailability, setApplyAvailability] = useState(false);
  const [applyReviewed, setApplyReviewed] = useState(false);
  const [applyZone, setApplyZone] = useState(false);
  const [applySection, setApplySection] = useState(false);
  const [applyRow, setApplyRow] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    function handleSelectionChange(event: Event) {
      const detail = (event as CustomEvent<{ ids?: string[] }>).detail;
      setSelectedIds(
        Array.isArray(detail?.ids)
          ? detail.ids.filter((value): value is string => typeof value === "string" && value.trim() !== "")
          : [],
      );
    }

    window.addEventListener("stock-selection-change", handleSelectionChange);

    return () => {
      window.removeEventListener("stock-selection-change", handleSelectionChange);
    };
  }, []);

  function openDialog() {
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function clearSelection() {
    window.dispatchEvent(new CustomEvent("stock-clear-selection"));
  }

  function selectAllFiltered() {
    window.dispatchEvent(
      new CustomEvent("stock-set-selection", {
        detail: { ids: allMatchingIds },
      }),
    );
  }

  return (
    <div className="stock-bulk-controls">
      <div className="bulk-toolbar">
        <button type="button" onClick={openDialog}>Bulk Edit</button>
        <button type="button" onClick={selectAllFiltered} disabled={allMatchingIds.length === 0}>
          Select All Filtered
        </button>
        <button type="button" onClick={clearSelection}>Clear Selected</button>
        <button type="submit" name="action" value="delete">Delete Selected</button>
      </div>
      <p className="muted stock-selected-count">
        {selectedIds.length} selected
      </p>
      {selectedIds.map((inventoryId) => (
        <input key={inventoryId} type="hidden" name="inventoryIds" value={inventoryId} />
      ))}

      {isMounted ? (
        <dialog ref={dialogRef} className="bulk-edit-dialog">
          <div className="bulk-edit-dialog-body">
            <div className="section-heading">
              <div>
                <h2>Bulk Edit Selected Discs</h2>
                <p className="muted">Only checked fields will be updated.</p>
              </div>
              <button type="button" className="link-button" onClick={closeDialog}>
                Close
              </button>
            </div>

            <div className="stack-form">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="applyAvailability"
                  value="true"
                  checked={applyAvailability}
                  onChange={(event) => setApplyAvailability(event.target.checked)}
                />
                <span>Change availability</span>
              </label>
              <label>
                Availability
                <select name="availability" defaultValue="true" disabled={!applyAvailability}>
                  <option value="true">Available</option>
                  <option value="false">Out</option>
                </select>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="applyReviewed"
                  value="true"
                  checked={applyReviewed}
                  onChange={(event) => setApplyReviewed(event.target.checked)}
                />
                <span>Change reviewed</span>
              </label>
              <label>
                Reviewed
                <select name="reviewed" defaultValue="true" disabled={!applyReviewed}>
                  <option value="true">Reviewed</option>
                  <option value="false">Needs review</option>
                </select>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="applyZone"
                  value="true"
                  checked={applyZone}
                  onChange={(event) => setApplyZone(event.target.checked)}
                />
                <span>Change zone</span>
              </label>
              <label>
                Zone
                <select name="zoneValue" defaultValue="W" disabled={!applyZone}>
                  {ZONE_OPTIONS.map((zone) => (
                    <option key={zone} value={zone}>
                      {formatZoneLabel(zone)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="applySection"
                  value="true"
                  checked={applySection}
                  onChange={(event) => setApplySection(event.target.checked)}
                />
                <span>Change section</span>
              </label>
              <label>
                Section
                <input type="text" name="sectionValue" maxLength={2} disabled={!applySection} />
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="applyRow"
                  value="true"
                  checked={applyRow}
                  onChange={(event) => setApplyRow(event.target.checked)}
                />
                <span>Change row</span>
              </label>
              <label>
                Row
                <input type="text" name="rowValue" maxLength={2} disabled={!applyRow} />
              </label>

              <div className="bulk-edit-dialog-actions">
                <button type="button" onClick={closeDialog}>Cancel</button>
                <button type="submit" name="action" value="edit">Save Changes</button>
              </div>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
