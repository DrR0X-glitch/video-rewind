import Link from "next/link";

import { BarcodeSvg } from "@/components/barcode-svg";
import { PrintLabelControls } from "@/components/print-label-controls";
import { getInventoryItemById } from "@/lib/server/store";
import { formatDiscFormat, formatLinkedTitleLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InventoryDiscLabelPage(
  props: PageProps<"/inventory/discs/[id]/label">,
) {
  const { id } = await props.params;
  const search = await props.searchParams;
  const disc = await getInventoryItemById(id);
  const autoPrint = search.print === "true";

  return (
    <div className="inventory-layout">
      <section className="panel section no-print">
        <div className="section-heading">
          <div>
            <h1>Disc Label</h1>
            <p className="muted">{disc.inventoryCode}</p>
          </div>
          <div className="header-actions">
            <Link href={`/inventory/discs/${disc.id}`}>Back to Disc</Link>
            <PrintLabelControls autoPrint={autoPrint} />
          </div>
        </div>
      </section>

      <section className="label-sheet">
        <article className="disc-label">
          <p className="disc-label-code">{disc.inventoryCode}</p>
          <BarcodeSvg value={disc.inventoryCode} moduleWidth={2} barHeight={84} />
          <p className="disc-label-meta">{formatDiscFormat(disc.format)}</p>
          <div className="disc-label-titles">
            {disc.linkedTitles.map((title) => (
              <p key={title.id}>{formatLinkedTitleLabel(title)}</p>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
