import Link from "next/link";
import { notFound } from "next/navigation";

import { CdIntakeFlow } from "@/app/inventory/new/cd/cd-intake-flow";
import { listInventoryZones } from "@/lib/server/inventory/zones";

export const dynamic = "force-dynamic";

export default async function CdIntakePage() {
  if (process.env.NODE_ENV !== "development") notFound();

  const zones = await listInventoryZones({ activeOnly: true });
  const defaultZone = zones.find((zone) => zone.code === "W")?.code ?? zones[0]?.code ?? "W";

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <h1>Find or create a CD release</h1>
        <p className="muted">
          Search Discogs by artist or release title, confirm the exact edition, then add a physical
          copy to stock.
        </p>
      </section>

      <CdIntakeFlow zones={zones} defaultZone={defaultZone} />

      <p className="utility-row">
        <Link href="/inventory/new">Back to title entry</Link>
      </p>
    </div>
  );
}
