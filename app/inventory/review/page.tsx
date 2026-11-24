import Link from "next/link";

import { applyReviewAction } from "@/app/inventory/review/actions";
import { ReviewBulkControls } from "@/components/review-bulk-controls";
import { StockTableBody } from "@/components/stock-table-body";
import { listStockDiscs } from "@/lib/data";

const REVIEW_PAGE_SIZE = 50;
export const dynamic = "force-dynamic";

type ReviewPageProps = {
  searchParams: Promise<{
    page?: string;
  }>;
};

export default async function InventoryReviewPage({ searchParams }: ReviewPageProps) {
  const params = await searchParams;
  const selectedPage =
    typeof params.page === "string" &&
    /^\d+$/.test(params.page) &&
    Number.parseInt(params.page, 10) > 0
      ? Number.parseInt(params.page, 10)
      : 1;
  const stockPage = await listStockDiscs({
    reviewedState: "false",
    excludeFormats: ["cd"],
    sort: "updated",
    dir: "asc",
    page: selectedPage,
    pageSize: REVIEW_PAGE_SIZE,
  });
  const items = stockPage.items;
  const totalCount = stockPage.totalCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / REVIEW_PAGE_SIZE));
  const currentPage = Math.min(selectedPage, totalPages);
  const pageStart = totalCount === 0 ? 0 : (currentPage - 1) * REVIEW_PAGE_SIZE + 1;
  const pageEnd = totalCount === 0 ? 0 : pageStart + items.length - 1;
  const previousPageHref = currentPage > 1 ? buildReviewHref(currentPage - 1) : null;
  const nextPageHref = currentPage < totalPages ? buildReviewHref(currentPage + 1) : null;
  const bulkFormId = "review-bulk-form";

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>Review Queue</h1>
            <p className="muted utility-row">
              {totalCount === 0
                ? "No discs waiting for review"
                : `Showing ${pageStart}-${pageEnd} of ${totalCount}`}
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
              {totalPages > 1 ? (
                <div className="header-actions stock-pagination">
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
                </div>
              ) : null}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

function buildReviewHref(page: number) {
  const params = new URLSearchParams();

  if (page > 1) {
    params.set("page", page.toString());
  }

  const query = params.toString();
  return query ? `/inventory/review?${query}` : "/inventory/review";
}
