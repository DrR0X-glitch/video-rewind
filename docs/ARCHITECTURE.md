# Application architecture decision

**Status:** Decided for the next version; revisit only if a trigger below appears.

## Decision

Build the next version as a **modular monolith**:

- Next.js serves the public catalogue, staff interface, and the app's server endpoints.
- PostgreSQL remains the authoritative store for catalogue, inventory, locations, staff permissions, customers, and transactions.
- Server-side domain modules own business rules and database access. Next.js pages, Server Actions, and Route Handlers are delivery interfaces that call those modules.
- Keep barcode, metadata lookup, identity, email/SMS, and payment providers behind server-side adapters.
- Deploy the app and database as separate processes/containers, as they are today, but keep one application deployment until operational needs justify splitting it.

Do not introduce a separately deployed API, microservices, a second database, or a backend-as-a-service for this version. They add more operational and security boundaries than the current product needs.

## Why this fits

This is a single-store staff tool and public catalogue with one relational data model. The planned workflows need reliable transactions across stock, rentals, sales, returns, and payments. PostgreSQL is a natural source of truth for those records, and a single application process can serve both server-rendered pages and interactive browser flows without internal HTTP calls between frontend and backend.

The browser camera scanner belongs in a client-side UI component. It can submit the decoded barcode to the Next.js server layer for lookup and inventory actions. A keyboard scanner or another client can use a manual barcode field or a Route Handler later. Neither requires a separate backend today.

This decision keeps an exit path: the domain modules can later be called from a separate API if the app gains another independently deployed client or a concrete operational reason to split.

## Target module boundaries

Keep the App Router as the transport and composition layer. Move business rules out of route/action files and out of the current mixed-domain store module over time.

```text
app/
  (public)/...                 public catalogue pages
  inventory/...                staff inventory pages
  checkout/...                 staff checkout pages, when added
  api/...                      HTTP endpoints for browser/external clients
lib/server/
  auth/                        session, identity mapping, permission checks
  catalog/                     title search, metadata, title mutations
  inventory/                   discs, stock operations, locations, movements
  checkout/                    rentals, sales, returns, refunds
  pricing/                     deals, discounts, tax calculation snapshots
  customers/                   narrowly scoped customer data access
  integrations/                barcode, TMDB/OMDb, messaging, payments
  db/                           PostgreSQL pool and versioned migrations
```

This is a direction, not a demand to create empty folders or move all 2,755 lines of `lib/server/store.ts` before feature work. Split a domain when changing or adding that domain; keep SQL close to its domain and use existing `pg` support unless a specific need justifies another data layer.

## Store-module cleanup policy

Treat cleanup as part of each feature task, not as an unrelated follow-up:

1. Before changing a domain, identify the functions and helpers it currently uses in `lib/server/store.ts`.
2. Move the touched behavior into the appropriate server-side domain module as part of that feature, keeping behavior the same unless the feature requires a behavior change.
3. Move shared helpers only when their ownership is clear. Put genuinely shared query types, row mappers, and value normalization in a small internal module instead of making domain modules import one another's private implementation details.
4. Add focused tests around extracted business rules and queries where practical; keep each extraction reviewable and run the project's verification commands.
5. Remove the old implementation after all callers use the domain module. Avoid a long-lived re-export layer that preserves the monolith under a new filename.

| Planned work                        | Existing `store.ts` responsibilities to extract as the work begins                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom titles and barcode lookup    | Title search/duplicate checks, title creation/update, TMDB collection handling; keep barcode-provider code in the integration adapter.                               |
| Location management and stock moves | Location normalization, stock view queries, item updates/bulk actions, and inventory-code helpers; add explicit location/movement services.                          |
| Staff identity                      | New `auth` module plus permission checks at every staff mutation/read boundary; avoid coupling domain services to the identity provider.                             |
| Checkout and returns                | Inventory availability changes and the new transaction, line-item, pricing, and return logic; keep state transitions and pricing snapshots in database transactions. |

Do not split the entire file ahead of feature work. This review found no large, untouched section with a clean boundary: public catalogue reads join title and disc data, while stock and title operations share row types, mappers, and validation. Moving those blocks now would require extracting common internals first and could create churn before the feature requirements settle. The small health check is too small to justify a standalone refactor. Start the split with the first catalog/inventory task, then repeat this policy for staff identity and checkout.

## Request and security boundaries

- Server Components can call server-side read services directly for request-rendered pages.
- Server Actions are convenient for mutations initiated by the Next.js UI.
- Route Handlers serve browser clients that need JSON, webhooks, health checks, or future external consumers.
- All three paths call the same domain services; do not duplicate business rules in Server Actions and API handlers.
- Validate untrusted input and authenticate/authorize inside the server-side operation boundary. Treat every Server Action and Route Handler as callable endpoints; UI visibility is not authorization.
- Keep database, integration credentials, and server-only modules out of client bundles. Add explicit server-only guards to modules that must never be imported by client components.
- Use a provider-neutral staff identity in application code. A chosen identity provider can authenticate staff and enforce 2FA; the app maps that identity to local roles and applies permissions to each operation.
- Keep the app private while inventory work proceeds without app authentication. Staff login, 2FA, server-side authorization, and audit coverage are required before public launch.

Next.js's installed security guidance describes data access functions as secure primitives that validate input, check authentication and authorization, and return only the data the caller needs. It also says to authenticate and authorize before sensitive Server Action operations. The planned service boundary follows that guidance.

## Persistence and integrations

- Keep one PostgreSQL database initially. Separate customer data into narrowly scoped tables and access methods; do not create a second datastore solely to claim separation.
- Use database transactions and constraints for stock movements and checkout state changes, including duplicate-checkout prevention.
- Store the applied item price, discount allocation, tax basis/result, and relevant policy/version snapshot with each finalized transaction so later configuration changes do not rewrite past sales.
- The former `schema.sql` is now the one-time current-schema baseline under `db/migrations/`. Add all future schema changes as new versioned migrations; production startup must not perform ad hoc schema changes or seed development records.
- Integrations expose application-level interfaces. Store only provider IDs and the minimum needed status for payments; never persist card numbers or security codes.
- Add a durable outbox/job mechanism when a workflow must reliably trigger email, SMS, payment follow-up, or other work after a database commit. Do not make core inventory mutations depend on an external provider being available.

## Production-readiness review

The architecture direction does not need another platform change, but the current MVP deployment setup needs a short foundation phase before new inventory behavior is built.

### Before inventory feature work

- Verify the new migration runner against the local Compose PostgreSQL database. Existing databases need a backup and schema check before explicitly recording the current baseline; never replay the baseline over existing data.
- Separate development, test, staging, and production settings. Production must require explicit database configuration and secrets; it must not inherit `dvd:dvd` fallback credentials or run development seed data.
- Exclude `.env*` and other secret/config files from the Docker build context. The current Dockerfile copies the build context, while `.dockerignore` does not currently exclude `.env*`.
- Establish local verification commands for lint, typecheck, server/browser unit tests, format check, build, and read-only database integration checks against the local Compose PostgreSQL database.
- Establish the server-only domain-service boundary and extract each domain as its inventory task begins. Keep the app private during this work, as already planned.

### Before public launch or production business data

- Complete staff sign-in, mandatory 2FA, server-side authorization, account recovery/offboarding, and audit logging before making staff routes public.
- Establish automated backups, retention, and a tested restore procedure. A mounted `backups` directory by itself is not a backup plan.
- Add structured operational logs, error reporting, and separate liveness/readiness checks; the current health route only checks that PostgreSQL responds and errors otherwise go to `console.error`.
- Complete the privacy/data-flow review for customer information and external providers before collecting customer records.
- Use production deployment configuration that cannot publish development credentials, seed data, or unnecessary database access.

### Before checkout and payment integrations

- Add database-level concurrency protection, idempotent transaction/payment callbacks, and tests for duplicate checkout, partial returns, refunds, and failures.
- Define recovery behavior for provider outages and durable post-commit work before relying on email, SMS, payment, or barcode-lookup services for business-critical operations.

These are staged release gates, not a demand to add enterprise infrastructure before local inventory work. Keep the first deployment simple, private, and recoverable; add controls when their data or exposure risk becomes real.

## Options considered

### Separate backend service now

Not chosen. A separate API would make sense if a native app or other independent client needs a stable external API, if the public site and staff system need separate scaling/deployments, or if a team/operational boundary requires it. None is currently established. Splitting now would add authentication between services, deployment and monitoring work, and another API contract without removing the need for careful domain boundaries.

### Backend-as-a-service as the system of record

Not chosen. Managed identity may still be useful, but the inventory and checkout domain needs relational transactions, history, and explicit pricing/tax snapshots. Replacing PostgreSQL now would add migration risk and would not remove the need for server-side authorization or domain services.

### Keep the current structure unchanged

Not chosen. The runtime stack is appropriate, but a 2,755-line store module mixing public catalogue, inventory, validation, SQL, and writes is a poor place to add locations, staff permissions, customer data, and checkout rules. The schema is also replayed by the app startup script rather than applied as versioned migrations. Improve these seams incrementally without replacing the stack.

## Revisit triggers

Reconsider a separate backend or a different deployment boundary if one or more of these become real requirements:

- A native mobile app or another independent client needs a stable API contract.
- The public catalogue and staff system need different release cadence, availability, or scaling.
- Payment/webhook or background processing requires independently operated workers.
- Data residency, vendor, privacy, or security review requires stronger isolation than one app deployment can provide.
- The team grows enough to own separate services and their operational overhead.

## Next technical decisions

These follow from the architecture and can be decided in the relevant feature planning, rather than blocking inventory discovery:

- Select a staff identity provider that supports enforceable 2FA, account recovery, and the required data-location/security constraints.
- Define the roles and permission matrix.
- Choose a versioned PostgreSQL migration runner and production migration procedure.
- Choose barcode formats and lookup providers; retain manual correction and entry.
- Decide whether payment is recorded against an external EFTPOS terminal or integrated with a provider.
- Set up separate development, test, staging, and production configuration; ensure development seeding cannot run in production.

## References

- Next.js, [Server Functions and security guidance](https://nextjs.org/docs/app/api-reference/directives/use-server)
- Next.js, [Authentication and authorization](https://nextjs.org/docs/app/guides/authentication)
