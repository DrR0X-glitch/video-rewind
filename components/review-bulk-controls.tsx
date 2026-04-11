"use client";

import { useEffect, useState } from "react";

export function ReviewBulkControls() {
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    function handleSelectionChange(event: Event) {
      const detail = (event as CustomEvent<{ count?: number }>).detail;
      setSelectedCount(typeof detail?.count === "number" ? detail.count : 0);
    }

    window.addEventListener("stock-selection-change", handleSelectionChange);

    return () => {
      window.removeEventListener("stock-selection-change", handleSelectionChange);
    };
  }, []);

  function clearSelection() {
    window.dispatchEvent(new CustomEvent("stock-clear-selection"));
  }

  return (
    <div className="stock-bulk-controls">
      <div className="bulk-toolbar">
        <button type="submit" name="action" value="review-selected">Mark Selected Reviewed</button>
        <button type="button" onClick={clearSelection}>Clear Selected</button>
        <button type="submit" name="action" value="delete">Delete Selected</button>
      </div>
      <p className="muted stock-selected-count">{selectedCount} selected</p>
    </div>
  );
}
