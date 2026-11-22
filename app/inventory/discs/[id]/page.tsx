import { BarcodeSvg } from "@/components/barcode-svg";
import Link from "next/link";

import { updateDisc } from "@/app/inventory/discs/[id]/actions";
import { ZONE_OPTIONS, formatZoneLabel } from "@/lib/constants";
import { getInventoryItemById } from "@/lib/server/store";
import {
  formatDateTime,
  formatAvailability,
  getAvailabilityTone,
  formatDiscFormat,
  formatInventoryIdentifier,
  formatLinkedTitleLabel,
  formatInventoryLocation,
  formatMediaType,
  formatSealed,
  getSealedTone,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InventoryDiscPage(props: PageProps<"/inventory/discs/[id]">) {
  const { id } = await props.params;
  const search = await props.searchParams;
  const disc = await getInventoryItemById(id);
  const primaryTitle = disc.linkedTitles[0];
  const returnTo = typeof search.returnTo === "string" ? search.returnTo : "";

  return (
    <div className="inventory-layout">
      <section className="panel section">
        <div className="section-heading">
          <div>
            <h1>Edit Disc</h1>
            <p className="muted">Disc ID: {formatInventoryIdentifier(disc)}</p>
          </div>
          {returnTo ? (
            <Link href={returnTo}>Back to stock</Link>
          ) : primaryTitle ? (
            <Link href={`/inventory/${primaryTitle.id}`}>Back to title</Link>
          ) : (
            <Link href="/inventory">Back to inventory</Link>
          )}
        </div>
      </section>

      <div className="two-column">
        <section className="panel section">
          <h2>Titles On Disc</h2>
          <ul className="plain-list plain-actions">
            {disc.linkedTitles.map((title) => (
              <li key={title.id}>
                <span>{formatLinkedTitleLabel(title)}</span>
                <span className="muted">{formatMediaType(title.mediaType)}</span>
                <Link href={`/inventory/${title.id}`}>Open Title</Link>
              </li>
            ))}
          </ul>
          <p className="muted">Location code: {disc.locationCode}</p>
          <p className="muted">Current location: {formatInventoryLocation(disc)}</p>
          <p className="muted">
            Last edited: {disc.updatedAt ? formatDateTime(disc.updatedAt) : "Unknown"}
          </p>
          <div className="barcode-panel">
            <BarcodeSvg value={disc.inventoryCode} />
            <div className="utility-row header-actions">
              <Link href={`/inventory/discs/${disc.id}/label?print=true`}>Print Label</Link>
            </div>
          </div>
        </section>

        <section className="panel section">
          <h2>Disc Details</h2>
          <form action={updateDisc} className="stack-form">
            <input type="hidden" name="discId" value={disc.id} />
            <input type="hidden" name="returnTitleId" value={primaryTitle?.id ?? ""} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label>
              Format
              <select name="format" defaultValue={disc.format}>
                <option value="dvd">{formatDiscFormat("dvd")}</option>
                <option value="blu-ray">{formatDiscFormat("blu-ray")}</option>
                <option value="4k-uhd">{formatDiscFormat("4k-uhd")}</option>
              </select>
            </label>

            <label>
              Zone
              <select name="zone" defaultValue={disc.zone}>
                {ZONE_OPTIONS.map((zone) => (
                  <option key={zone} value={zone}>
                    {formatZoneLabel(zone)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Section
              <input type="text" name="section" defaultValue={disc.section} maxLength={2} />
            </label>

            <label>
              Row
              <input type="text" name="row" defaultValue={disc.row} maxLength={2} />
            </label>

            <div className="inline-split">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="availability"
                  value="true"
                  defaultChecked={disc.availability}
                />
                <span className={`status-pill status-${getAvailabilityTone(disc.availability)}`}>
                  {formatAvailability(disc.availability)}
                </span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="reviewed"
                  value="true"
                  defaultChecked={disc.reviewed}
                />
                <span className={`status-pill status-${disc.reviewed ? "good" : "warn"}`}>
                  {disc.reviewed ? "Reviewed" : "Needs review"}
                </span>
              </label>
            </div>

            <div className="inline-split">
              <label className="checkbox-row">
                <input type="checkbox" name="sealed" value="true" defaultChecked={disc.sealed} />
                <span className={`status-pill status-${getSealedTone(disc.sealed)}`}>
                  {formatSealed(disc.sealed)}
                </span>
              </label>
            </div>

            <p className="muted">
              Last rented: {disc.lastRentedAt ? formatDateTime(disc.lastRentedAt) : "Not recorded"}
            </p>

            <label>
              Day price
              <input type="text" name="dayPrice" defaultValue={disc.dayPrice.toString()} />
            </label>

            <label>
              Weekend price
              <input type="text" name="weekendPrice" defaultValue={disc.weekendPrice.toString()} />
            </label>

            <label>
              Late class
              <input type="text" name="lateClass" defaultValue={disc.lateClass.toString()} />
            </label>

            {disc.linkedTitles.map((title) => (
              <div key={`linked-${title.id}`} className="linked-title-fields">
                <input type="hidden" name="linkedTitleId" value={title.id} />
                {title.mediaType === "series" ? (
                  <div className="inline-split">
                    <label>
                      <span>{title.title} season start</span>
                      <input
                        type="text"
                        name="seasonStart"
                        defaultValue={title.seasonStart?.toString() ?? ""}
                      />
                    </label>
                    <label>
                      <span>{title.title} season end</span>
                      <input
                        type="text"
                        name="seasonEnd"
                        defaultValue={title.seasonEnd?.toString() ?? ""}
                        placeholder={title.seasonStart?.toString() ?? "Same as start"}
                      />
                    </label>
                    <label>
                      <span>{title.title} episode start</span>
                      <input
                        type="text"
                        name="episodeStart"
                        defaultValue={title.episodeStart?.toString() ?? ""}
                        placeholder="Whole season"
                      />
                    </label>
                    <label>
                      <span>{title.title} episode end</span>
                      <input
                        type="text"
                        name="episodeEnd"
                        defaultValue={title.episodeEnd?.toString() ?? ""}
                        placeholder={title.episodeStart?.toString() ?? "Same as start"}
                      />
                    </label>
                  </div>
                ) : (
                  <>
                    <input type="hidden" name="seasonStart" value="" />
                    <input type="hidden" name="seasonEnd" value="" />
                    <input type="hidden" name="episodeStart" value="" />
                    <input type="hidden" name="episodeEnd" value="" />
                  </>
                )}
              </div>
            ))}

            <label>
              Notes
              <textarea name="notes" rows={5} defaultValue={disc.notes ?? ""} />
            </label>

            <button type="submit">Save Changes</button>
          </form>
        </section>
      </div>
    </div>
  );
}
