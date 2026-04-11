import Link from "next/link";

import { applyReviewAction } from "@/app/inventory/review/actions";
import { ReviewBulkControls } from "@/components/review-bulk-controls";
import { StockTableBody } from "@/components/stock-table-body";
import { listStockDiscs } from "@/lib/data";

const REVIEW_PAGE_SIZE = 10000;
export const dynamic = "force-dynamic";

export default async function InventoryReviewPage() {
  const stockPage = await listStockDiscs({
    reviewedState: "false",
    sort: "primary",
    dir: "desc",
    page: 1,
    pageSize: REVIEW_PAGE_SIZE,
  });
  const items = stockPage.items;
  const bulkFormId = "review-bulk-form";

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>Review Queue</h1>
            <p className="muted utility-row">
              {items.length === 0 ? "No discs waiting for review" : `${items.length} unreviewed discs`}
            </p>
          </div>
          <Link href="/inventory/stock">Back to Stock</Link>
        </div>
      </section>

      <section className="section">
        <div className="stock-table-shell">
          <form id={bulkFormId} action={applyReviewAction} className="stack-form">
            <table>
              <thead>
                <tr>
                  <th className="selection-column">Select</th>
                  <th>Disc</th>
                  <th>Format</th>
                  <th>Titles</th>
                  <th>Primary</th>
                  <th>Sealed</th>
                  <th>Last Edited</th>
                  <th>Location</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <StockTableBody
                bulkFormId={bulkFormId}
                currentStockHref="/inventory/review"
                items={items}
                rowAction={{ label: "Review", submitName: "singleReviewId" }}
                showAvailabilityColumn={false}
                showPrimaryColumn
                titleDisplayMode="review"
              />
            </table>
            <div className="section stock-table-footer">
              <ReviewBulkControls />
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
