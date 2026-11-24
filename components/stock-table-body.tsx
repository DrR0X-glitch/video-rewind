"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import {
  formatAvailability,
  formatDateTime,
  formatDiscFormat,
  getAvailabilityTone,
  formatLinkedTitleLabel,
  formatInventoryLocation,
  formatInventoryShortIdentifier,
} from "@/lib/format";
import type { StockViewDisc } from "@/lib/types";

type StockTableBodyProps = {
  bulkFormId: string;
  currentStockHref: string;
  items: StockViewDisc[];
  rowAction?: {
    label: string;
    submitName: string;
  };
  showAvailabilityColumn?: boolean;
  showPrimaryColumn?: boolean;
  showReviewedColumn?: boolean;
  titleDisplayMode?: "stock" | "review";
};

export function StockTableBody({
  bulkFormId,
  currentStockHref,
  items,
  rowAction,
  showAvailabilityColumn = true,
  showPrimaryColumn = false,
  showReviewedColumn = false,
  titleDisplayMode = "stock",
}: StockTableBodyProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const lastSelectedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("stock-selection-change", {
        detail: { count: selectedIds.size, ids: Array.from(selectedIds) },
      }),
    );
  }, [selectedIds]);

  useEffect(() => {
    function handleSetSelection(event: Event) {
      const detail = (event as CustomEvent<{ ids?: string[] }>).detail;
      const ids = Array.isArray(detail?.ids)
        ? detail.ids.filter(
            (value): value is string => typeof value === "string" && value.trim() !== "",
          )
        : [];

      setSelectedIds(new Set(ids));
      lastSelectedIndexRef.current = null;
    }

    function handleClearSelection() {
      setSelectedIds(new Set());
      lastSelectedIndexRef.current = null;
    }

    window.addEventListener("stock-set-selection", handleSetSelection);
    window.addEventListener("stock-clear-selection", handleClearSelection);

    return () => {
      window.removeEventListener("stock-set-selection", handleSetSelection);
      window.removeEventListener("stock-clear-selection", handleClearSelection);
    };
  }, []);

  function handleSelectionChange(
    itemId: string,
    itemIndex: number,
    shiftKey: boolean,
    nextChecked: boolean,
  ) {
    const rangeAnchor =
      shiftKey && lastSelectedIndexRef.current !== null ? lastSelectedIndexRef.current : null;

    setSelectedIds((currentSelectedIds) => {
      const nextSelectedIds = new Set(currentSelectedIds);
      const isRangeSelection = rangeAnchor !== null;

      if (isRangeSelection) {
        const rangeStart = Math.min(rangeAnchor, itemIndex);
        const rangeEnd = Math.max(rangeAnchor, itemIndex);

        for (let index = rangeStart; index <= rangeEnd; index += 1) {
          const rangeItemId = items[index]?.id;

          if (!rangeItemId) {
            continue;
          }

          if (nextChecked) {
            nextSelectedIds.add(rangeItemId);
          } else {
            nextSelectedIds.delete(rangeItemId);
          }
        }
      } else if (nextChecked) {
        nextSelectedIds.add(itemId);
      } else {
        nextSelectedIds.delete(itemId);
      }

      return nextSelectedIds;
    });

    lastSelectedIndexRef.current = itemIndex;
  }

  if (items.length === 0) {
    const columnCount =
      7 +
      (showAvailabilityColumn ? 1 : 0) +
      (showPrimaryColumn ? 1 : 0) +
      (showReviewedColumn ? 1 : 0) +
      1;

    return (
      <tbody>
        <tr>
          <td colSpan={columnCount}>No discs found for the current stock view.</td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody>
      {items.map((item, itemIndex) => (
        <tr key={item.id} id={`disc-${item.id}`}>
          <td className="selection-column">
            <input
              type="checkbox"
              name="inventoryIds"
              value={item.id}
              form={bulkFormId}
              checked={selectedIds.has(item.id)}
              readOnly
              onClick={(event) =>
                handleSelectionChange(item.id, itemIndex, event.shiftKey, !selectedIds.has(item.id))
              }
            />
          </td>
          <td>
            <Link
              href={`/inventory/discs/${item.id}?returnTo=${encodeURIComponent(`${currentStockHref}#disc-${item.id}`)}`}
            >
              {formatInventoryShortIdentifier(item)}
            </Link>
          </td>
          <td>{formatDiscFormat(item.format)}</td>
          <td>
            <div className="stock-title-cell">
              <div className="stock-title-list">
                {item.linkedTitles.map((title) =>
                  titleDisplayMode === "review" ? (
                    <span className="stock-title-entry" key={title.id}>
                      <StockTitleArt posterUrl={title.posterUrl} />
                      <span className="stock-title-entry-text">
                        <strong>{formatLinkedTitleLabel(title)}</strong>
                        <br />
                        <span className="muted">{title.sortTitle}</span>
                      </span>
                    </span>
                  ) : (
                    <span className="stock-title-entry" key={title.id}>
                      <StockTitleArt posterUrl={title.posterUrl} />
                      <span className="stock-title-entry-text">
                        {formatLinkedTitleLabel(title)}
                      </span>
                    </span>
                  ),
                )}
              </div>
              {item.collectionName ? (
                <span className="muted">
                  {item.collectionName} #{item.sortSequence}
                </span>
              ) : null}
            </div>
          </td>
          {showAvailabilityColumn ? (
            <td>
              <span className={`status-pill status-${getAvailabilityTone(item.availability)}`}>
                {formatAvailability(item.availability)}
              </span>
            </td>
          ) : null}
          {showPrimaryColumn ? (
            <td suppressHydrationWarning>
              {item.isPrimary ? (
                <span className="status-pill status-primary">Primary</span>
              ) : (
                "Duplicate"
              )}
            </td>
          ) : null}
          {showReviewedColumn ? <td>{item.reviewed ? "Yes" : "No"}</td> : null}
          <td>{item.sealed ? "Yes" : "No"}</td>
          <td>{item.updatedAt ? formatDateTime(item.updatedAt) : "—"}</td>
          <td>{formatInventoryLocation(item)}</td>
          <td>{item.notes || "—"}</td>
          <td>
            {rowAction ? (
              <button type="submit" name={rowAction.submitName} value={item.id} form={bulkFormId}>
                {rowAction.label}
              </button>
            ) : (
              <Link href={`/inventory/discs/${item.id}`}>Edit Disc</Link>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function StockTitleArt({ posterUrl }: { posterUrl?: string | null }) {
  if (!posterUrl) {
    return (
      <span className="stock-title-art-placeholder" aria-hidden="true">
        No art
      </span>
    );
  }

  return (
    <Image
      className="stock-title-art"
      src={posterUrl}
      alt=""
      width={36}
      height={54}
      sizes="36px"
      loading="lazy"
    />
  );
}
