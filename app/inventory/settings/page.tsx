import Link from "next/link";

import {
  addInventoryZone,
  updateInventoryZoneLabel,
  updateInventoryZoneStatus,
} from "@/app/inventory/settings/actions";
import { listInventoryZones } from "@/lib/server/inventory/zones";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  added: "Zone added.",
  updated: "Zone name updated.",
  activated: "Zone activated.",
  deactivated: "Zone deactivated.",
};

type InventorySettingsPageProps = {
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function InventorySettingsPage({ searchParams }: InventorySettingsPageProps) {
  const [params, zones] = await Promise.all([searchParams, listInventoryZones()]);
  const notice = params.notice ? notices[params.notice] : undefined;

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>Inventory Settings</h1>
            <p className="muted">Manage the zones used by inventory locations.</p>
          </div>
          <Link href="/inventory">Back to Inventory</Link>
        </div>
      </section>

      {params.error ? (
        <p className="status-pill status-bad" role="alert">
          {params.error}
        </p>
      ) : notice ? (
        <p className="status-pill status-good" role="status">
          {notice}
        </p>
      ) : null}

      <section className="panel section">
        <h2>Add Zone</h2>
        <form action={addInventoryZone} className="stack-form">
          <div className="inline-split">
            <label>
              Zone code
              <input
                type="text"
                name="code"
                required
                minLength={1}
                maxLength={4}
                pattern="[A-Za-z0-9]{1,4}"
                autoCapitalize="characters"
                aria-describedby="zone-code-help"
              />
            </label>
            <label>
              Zone name
              <input type="text" name="label" required maxLength={40} />
            </label>
          </div>
          <p className="muted" id="zone-code-help">
            Use a unique 1–4 character code. Existing stock keeps its current zone when a zone is
            deactivated.
          </p>
          <button type="submit">Add Zone</button>
        </form>
      </section>

      <section className="panel section">
        <h2>Zones</h2>
        <p className="muted">
          Zone codes stay fixed after creation. Rename the displayed name or deactivate a zone to
          remove it from new inventory choices. Existing inventory remains assigned to inactive
          zones.
        </p>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <tr key={zone.code}>
                <td>{zone.code}</td>
                <td>
                  <form action={updateInventoryZoneLabel} className="header-actions">
                    <input type="hidden" name="code" value={zone.code} />
                    <label className="sr-only" htmlFor={`zone-label-${zone.code}`}>
                      Name for zone {zone.code}
                    </label>
                    <input
                      id={`zone-label-${zone.code}`}
                      type="text"
                      name="label"
                      required
                      maxLength={40}
                      defaultValue={zone.label}
                    />
                    <button type="submit">Save Name</button>
                  </form>
                </td>
                <td>{zone.isActive ? "Active" : "Inactive"}</td>
                <td>
                  <form action={updateInventoryZoneStatus}>
                    <input type="hidden" name="code" value={zone.code} />
                    <input type="hidden" name="isActive" value={zone.isActive ? "false" : "true"} />
                    <button type="submit">{zone.isActive ? "Deactivate" : "Activate"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
