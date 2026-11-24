# Next-version roadmap

## Purpose

Organise the next version of Video Rewind at a high level. This roadmap groups features and shows their dependencies; detailed requirements, estimates, and delivery dates will be worked out before implementation.

## Product direction

Build a secure, staff-only checkout and inventory system that supports rental and purchase transactions, while keeping customer data collection purposeful and limited. Keep the public catalogue as a separate customer-facing experience. Customer accounts, watchlists, and reservations are deferred from the first delivery of this version.

## Technical direction

The architecture decision is recorded in [ARCHITECTURE.md](./ARCHITECTURE.md): continue with a modular Next.js/PostgreSQL application, establish server-side domain boundaries, and revisit a separate backend only if a concrete trigger appears.

Inventory work can be built without app authentication while the application remains private; staff login must be complete before the application is made public.

## Workstreams

### 0. Production foundation before inventory

Make the current private app safe to evolve before implementing the inventory feature set.

- Verify the versioned migration runner against the local Compose PostgreSQL database. Existing databases need a backup and baseline check before recording migration history.
- Separate development, test, staging, and production configuration. Production startup must require explicit credentials and must never auto-seed development records.
- Exclude `.env*` from Docker build context and keep secrets out of images.
- Establish a local verification command for lint, typecheck, server/browser unit tests, format check, build, and PostgreSQL-backed integration tests; no CI is planned.
- Establish the server-only domain-service boundary, then include extraction of touched `store.ts` behavior in each feature task.
- Keep this phase private and focused. Staff authentication is not needed to develop inventory, but it is still required before public launch.

### 1. Architecture and privacy discovery

Make the small set of decisions that affect inventory and checkout before adding more server-side behavior or collecting customer transaction data.

- Confirm the modular Next.js/PostgreSQL direction or record a concrete reason to split the backend.
- Define the server-side boundary where staff authorization will be enforced and the domain data must not depend on a particular login provider.
- Map data flows and vendors, including hosting, email/SMS, payment processing, barcode lookup, backups, and support access. Decide where data is stored and whether any provider receives it overseas.
- Confirm which privacy and record-keeping obligations apply to the business and its vendors before designing customer data collection. Assess Australian Privacy Principles and any applicable state or contractual obligations with qualified advice; this roadmap is not a compliance determination.

**Gate:** record the application boundary, authorization seam, privacy assumptions, and vendor/data-location constraints. This is an architecture decision, not a full rewrite or a requirement to implement staff accounts before inventory discovery.

### 2. Catalogue entry and physical inventory operations

Make inventory faster and more reliable before relying on it for checkout.

- Allow staff to create and edit custom titles when there is no TMDB record, with clear source/provenance and duplicate checks.
- As title-entry work begins, move the relevant search, duplicate-detection, and title-write operations out of `lib/server/store.ts` into a catalog service; keep any shared title/disc projection helpers in a clearly owned shared module.
- Store UPC/EAN on each physical inventory copy. Identical releases may share a repeated code, and a title may have different codes across releases.
- Add UPC/EAN entry to disc intake and editing, with browser-camera scanning where supported and a manual field for fallback and keyboard-wedge scanners. Defer external barcode lookup and metadata services.
- Remove printed internal barcode labels. Keep `inventory_code` as the app's internal staff identifier.
- Provide staff-managed location configuration for zones, sections, and rows, including adding, renaming, deactivating, and validating options.
- Provide a guided stock-move workflow that records the old and new location, affected items, staff member, time, and any exceptions. Avoid silently changing location history.
- As location and stock-move work begins, move the affected stock queries and mutations out of `lib/server/store.ts` into inventory/location services; keep this extraction within the feature task.
- Keep the existing inventory-code and title/disc distinction intact unless discovery shows a business need to change it.
- Add VHS as a staff-managed inventory format backed by existing TMDB movie/series metadata; VHS-only stock must not create a public catalogue listing.
- Add compact poster/artwork thumbnails to staff stock rows using linked title artwork.
- Treat CDs as a separate staff-only catalogue workstream. Keep Discogs behind a server-side provider boundary and model one release record per Discogs release; link each physical CD copy to that record so duplicate copies do not duplicate release metadata or tracks.
- Store a compact track list per Discogs release (position, title, and duration) for staff track search and release pages. The project owner confirmed permanent storage of Discogs CC0 metadata with attribution and a direct release link; show the attribution on the release page. Avoid copying full Discogs payloads or per-track credits.
- Fetch Discogs album art only on the release detail page under its separate non-CC0 image terms; do not persist it or load it into stock/search pages. Cap browser caching at six hours, avoid server/CDN/image-optimizer caching, and use a generic CD placeholder elsewhere.
- See the [CD catalog plan](./CD_CATALOG_PLAN.md) for the proposed tables, storage estimate, metadata attribution, image loading boundary, and phased staff workflow.

### 3. Staff identity and security controls

Implement staff access before exposing staff-only inventory administration or checkout on a public deployment.

- Establish staff identity, account lifecycle, roles/permissions, session handling, recovery, and mandatory two-factor authentication for staff access to checkout and record changes.
- Enforce authorization on the server for every staff operation; hiding controls in the UI is not an access control.
- Define audit events for sign-in/security changes, customer-record access, stock movement, and record corrections.
- Set operational security expectations: secret management, encryption in transit and at rest, least-privilege access, backup/restore, monitoring, incident response, and staff account offboarding.

### 4. Rental and sale checkout core

Model a transaction as a durable record with line items and a complete price snapshot, rather than only changing each disc's availability.

- Support staff-only checkout for rentals and sales, with customer capture as required for each purchase and a privacy notice at collection.
- Define customer fields separately for rental and sale workflows; decide what is mandatory, optional, or not collected. Avoid collecting marketing consent as a condition of purchase.
- Prevent a disc from being checked out or sold twice, including when two staff members are serving concurrently.
- Record checkout time, staff member, customer reference, item condition, due date where relevant, line-item prices, discounts, tax treatment, payment status, and receipt details.
- Support returns, partial returns, overdue items, extensions, damaged/lost items, voids, refunds, and corrections with an audit trail.
- Keep rental inventory lifecycle separate from sale inventory lifecycle where the rules differ.

### 5. Pricing, deals, tax, and payment operations

Make pricing rules explicit, reproducible, and reviewable.

- Support configurable promotions such as “3 for $10,” with eligibility, dates, stacking rules, exclusions, and deterministic allocation of the discount across line items.
- Decide how discounts interact with refunds, partial returns, exchanges, and price overrides.
- Confirm GST registration and treatment for rental fees, sales, discounts, deposits/bonds, late fees, and other charges with an accountant. Store tax codes/rates and the applied tax result with each transaction so later configuration changes do not rewrite history.
- Show customer-facing prices correctly and produce receipts/tax invoices that meet the business's obligations.
- Decide which payment methods are recorded and whether payments are processed through an existing EFTPOS terminal or an integrated provider. Prefer provider-hosted/tokenised payment handling; do not store card numbers or security codes in this app.
- Include cash handling, split tender, payment failure, refund, end-of-day reconciliation, and transaction export requirements in discovery.

### 6. Checkout experience and service integrations

- Build a fast staff checkout flow for desktop and mobile, with camera scanning on mobile and a manual barcode field as a fallback.
- Match scanned UPC/EAN values to available copies; when identical copies share a code, any available copy can be selected. Store the selected inventory item on the transaction so returns resolve against the exact rented copy.
- Make the scan-to-cart loop robust: clear match/no-match feedback, duplicate scan behavior, quantity rules, correction/removal, and confirmation before completion.
- Add customer search/create flows that minimise data exposure and prevent accidental duplicate records.
- Integrate mailing/SMS only after choosing a provider, defining message purposes and consent/opt-out behavior, and deciding what information may be included in receipts or reminders.
- Add barcode lookup providers behind an adapter with timeouts, rate limits, provenance, and a manual-entry fallback.
- Keep integrations replaceable and avoid making core checkout correctness depend on a third-party metadata or messaging service being available.

### 7. Reporting, operations, and incremental UI improvements

- Add operational views for open rentals, due/overdue items, returns, sales, discounts, tax totals, stock movement, and reconciliation.
- Provide exports needed by accounting and store operations, with permissions and audit logging for customer-bearing exports.
- Improve existing screens iteratively based on staff feedback; UI polish is a continuous workstream rather than a prerequisite for the core data and security design.
- Add automated unit and integration coverage for pricing, tax snapshots, inventory transitions, permissions, and audit events, plus browser end-to-end coverage for critical staff journeys.

## Suggested delivery order

1. **Foundation and architecture decisions:** establish migrations, environment separation, local PostgreSQL tests, and the modular app boundary; record privacy and vendor assumptions. No platform rewrite is planned without evidence it is needed.
2. **Inventory-first feature work:** add custom titles, barcode-assisted entry, configurable locations, and traceable stock moves. Develop and validate these before building the checkout workflow.
3. **Staff identity and public-release gate:** implement staff accounts, mandatory 2FA, server-side permissions, audit logging, backups/restore, monitoring, and privacy controls before public launch or production customer data.
4. **Checkout vertical slice:** staff scans/selects an item, identifies the customer, completes one rental or sale, records payment, and generates a receipt; include atomic stock updates and audit history.
5. **Operational completeness:** returns, extensions, refunds/voids, bundles/promotions, tax calculation and documents, reconciliation, and reporting.
6. **Integrations and hardening:** mobile camera scanning, email/SMS, provider resilience, security review, privacy review, and end-to-end testing.
7. **Deferred customer features:** evaluate customer accounts, watchlists, and reservations only after staff checkout and privacy foundations are stable.

Inventory feature work can precede the account implementation. Public launch remains gated on staff login, 2FA, and server-side authorization. The order is not a dated commitment; break each stage into small vertical slices and estimate after the discovery gate.

For every roadmap feature task, include extraction of the corresponding `lib/server/store.ts` behavior as part of its acceptance criteria. Keep the refactor incremental and domain-aligned; there is no separate whole-file rewrite phase.

## Decisions for the planning session

- What exactly counts as a purchase versus a rental, and which customer details are required for each?
- Are staff payments processed by a separate EFTPOS terminal, or should the app integrate with a payment provider?
- Which charges exist: rental fees, late fees, deposits/bonds, damage/loss charges, and refunds?
- Which deals should launch first, and can offers combine?
- What current records or external systems must be imported or reconciled?
- Which staff roles need different permissions, and who can create/recover staff accounts?
- Which barcode types and lookup sources matter for the local collection?
- What retention period is required for customer, transaction, tax, audit, and security records?
- Which jurisdictions, privacy regimes, accounting obligations, and vendor/data-location constraints have been confirmed?

## Regulatory and service references

These sources inform discovery questions; they do not determine the business's legal obligations:

- OAIC, [Australian Privacy Principles](https://www.oaic.gov.au/privacy/australian-privacy-principles/read-the-australian-privacy-principles) and [APP 11 security guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information)
- OAIC, [Notifiable Data Breaches scheme](https://www.oaic.gov.au/privacy/notifiable-data-breaches/when-to-report-a-data-breach)
- OVIC, [Victorian Information Privacy Principles guidance](https://ovic.vic.gov.au/privacy/resources-for-organisations/guidelines-to-the-information-privacy-principles/)
- ATO, [GST and tax invoices](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices) and [how GST works](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/how-gst-works)
