# STATUS

**Project:** BOKPOINTS, a B2B2C loyalty platform for SMEs in Finland / EU.
**Phase:** MVP, build order steps 1 to 5 are done, and step 6's API half (6A) is done; the store and admin screens (6B) are next.
**Last updated:** 23 Oct 2026, after Build 9 (pending customers and oversight, 6A): a cashier can register a customer by email at the till and the points attach on first sign-in; owners and managers can adjust a balance; admins can claw back; both can read the audit log. The till gained the "customer without the app" form. 69 unit and 189 integration tests green; the whole flow was exercised live.

## Done

- **Repo and tooling.** pnpm monorepo at `~/bokpoints`, private GitHub remote. CI runs
  typecheck, lint, unit tests and integration tests against a PostgreSQL 17 service.
- **PRD and FRD exported.** `docs/PRD.md` and `docs/FRD.md`, converted from the source
  PDFs. All 114 `FR-` requirement IDs and `AC-1` to `AC-11` verified against the source.
- **Points engine** in `packages/shared`, pure functions, no I/O: calculation with
  rounding, minimum purchase and per-transaction cap; expiry with the short-month clamp;
  FIFO consumption; balance and adjustment rules.
- **Role and capability matrix** in `packages/shared`, straight from the FRD section 2
  table.
- **Database schema.** 15 tables from the FRD section 3 data model, plus store branches, with Drizzle
  migrations, a CHECK that keeps entry points pointing in the right direction, and
  database triggers that make the ledger and the audit log append-only.
- **Ledger write path** in `apps/api/src/db/ledger.ts`: award with idempotency, manual
  adjustment, admin fraud clawback, balance read. All in single transactions, with the
  balance update guarded in SQL so concurrency cannot drive a balance negative.
- **API**: Fastify, versioned under `/v1`, with the three operations the Cashier screen
  needs (identify, award, balance), the Supabase session resolver, and an OpenAPI
  document generated from the same Zod schemas that validate the requests.
  Every call is authenticated, scoped to one store and permission-checked on the server.
- **Guards on the write path**: a suspended or offboarded store cannot award, a
  deactivated staff account cannot get in, a deleted customer cannot be awarded, a
  lost or revoked credential does not resolve, a replay with a different amount is
  refused, and the scanning and awarding endpoints are rate limited.
- **Point batches**: every award creates a batch that records its expiry date and its
  remaining points. Adjustments and clawbacks draw the batches down, so the expiry
  job cannot take the same points twice.
- **Review round of 22 Oct 2026** (from the external review): `TRUST_PROXY` passed to
  Fastify as `trustProxy` so the rate limiter keys on the caller behind a proxy
  (D-095); the idempotency race path refuses a different amount (D-092); batch
  drawdowns lock the rows they read (`FOR UPDATE`); the earn rate is bounded by a
  CHECK (`points_rules_rate_check` at 1,000,000 thousandths, D-093); two misplaced
  docblocks fixed; the public `/v1/openapi.json` documented in D-095.

- **Supabase auth** (D-098 to D-101): tokens are verified locally against the
  project's public keys (asymmetric only), staff and admin must have passed a second
  factor (`403 MFA_REQUIRED` otherwise), and `staff_users.auth_user_id` links a staff
  account to its Supabase user. Built and tested with locally generated keys; **not yet
  run against the live project.**
- **Store branches** (D-103, D-104): optional `store_locations`. Points stay per store,
  an award records its branch, a member can be limited to one. Solo stores are unchanged.
- **Row-level security** on every table, with no policies (D-102), checked by a test.
- **Scripts**: `pnpm bootstrap:admin` creates the first admin, `pnpm staff:login` gets a
  real second-factor token (D-105). `pnpm dev` reads `apps/api/.env`.
- **Migration journal fixed** (D-106): `0005` was missing from Drizzle's journal, so a
  real `drizzle-kit migrate` would have skipped it. It is replaced by a generated
  migration, and a test now keeps the journal and the files in step.
- **Hosted `0006` migration applied** (Build 5): the fresh migration — store branches,
  `auth_user_id`, location foreign keys, row-level security — is live on the Supabase
  project (`eu-north-1`) as well as locally. RLS is enabled on every table with no
  policies (D-102), verified server-side against the hosted database. The hosted
  connection lives in `apps/api/.env` as `SUPABASE_DB_URL`.
- **Store setup endpoints** (D-107): `POST /v1/admin/stores` creates a whole store in
  one call (active store, points rule version 1, optional branches, first owner with
  their Supabase id), and `POST /v1/stores/:storeId/staff` lets an owner invite
  managers and cashiers with an optional one-branch limit; a manager invites cashiers
  only, and nothing hands out ownership. Everything is capability-checked, audited,
  and the first award can now be created without touching the database.
- **The points expiry job** (D-108): `pnpm expiry:run` expires every due batch once —
  one `expire` ledger entry per batch, remaining points zeroed in the same
  transaction, batches locked like adjustments, balance delta guarded. Two runs on
  the same day, or two runs racing, each expire exactly once (tested).
- **First live run against the Supabase project** (Next 1, done): an admin user made
  in the live project, linked with `bootstrap:admin`, signed in with a real
  second factor and got an ES256 token the resolver verified locally (D-098 to
  D-100). With it: `POST /v1/admin/stores` created the live first store
  ("Kahvila Bea") with a rule and two branches; the owner invited a cashier
  limited to the Kamppi branch; a real award for 25 points was recorded at that
  branch without naming it (D-104); `expiry:run` expired the batch once, then
  nothing on a second run. `ALLOW_DEV_AUTH` is now off, so the dev resolver is
  not in play; the two scripts read `apps/api/.env` directly.

- **The Cashier screen** (Build 7, D-109, D-110): `apps/web` is a real React +
  Vite + TypeScript PWA (`pnpm dev` now starts the API and the screen together).
  It signs in with Supabase email + password + TOTP, including first-time
  authenticator enrolment; resolves the caller's store and branch through
  `GET /v1/me`; takes a scan from a keyboard-wedge scanner (or a typed code) into
  a focused input; identifies the customer and shows their balance; previews the
  points live from a new read-only endpoint
  (`POST /v1/stores/:storeId/awards/preview`) so the maths never lives in the
  browser; confirms with a fresh idempotency key; and shows the recorded points,
  new balance and expiry. Plain-language error states; installable PWA shell with
  no offline cache (the offline queue stays build step 8).
- **Verified live, end to end**: with a real Supabase token through the Vite
  proxy, `/v1/me` returned the cashier's membership and the store's two branches,
  `/identify` with `CUST-QR-0001` returned Aino (15 points), and a €12.50 preview
  returned 12 points expiring 22 Jan 2027 at Kamppi while the balance stayed 15 —
  the preview writes nothing. Spec: `docs/superpowers/specs/2026-10-22-cashier-screen.md`;
  plan: `docs/superpowers/plans/2026-10-22-cashier-screen.md`.

- **The customer app's first slice** (Build 8, D-111, D-112): `apps/customer` is
  an Expo (React Native) app with a web export. Sign-in is an email one-time code
  (FR-AUTH-1), then a mandatory first-name step; the home screen opens on the
  personal QR, shows a notice when points expire within 14 days, and lists every
  store with a balance and its last activity. Tapping a store shows the last 100
  entries with the true balance after each (FR-CUS-1/2/3/8).
- **Customer identity and API**: `customers.auth_user_id` (migration 0007,
  local only), provisioning that links a verified email or refuses to take over a
  linked row, one active `app_qr` credential per customer, and five endpoints that
  always derive the identity from the token — profile get/patch, stores, history
  and expiring. A separate resolver accepts `aal1` customer tokens with an email
  claim, while staff stay on `aal2`. CORS is an explicit allow-list
  (`CORS_ORIGINS`), empty by default.
- **Verified live**: a real Supabase `aal1` token called `GET /v1/customer/me`,
  which created customer + credential; a €12.50 award at Kahvila Bea then appeared
  as 12 points in the customer's store list and history, with `balanceAfter` 12.

- **Pending customers and oversight (Build 9, 6A, D-113, D-114)**: `POST
  /v1/stores/:storeId/customers` registers a customer by email (the pending row is
  a `customers` row with no `auth_user_id`, claimed by the first sign-in with that
  email); the till has a "customer without the app" form. Owners and managers adjust
  points with a required reason (never below zero); admins claw back, which may go
  negative and marks the store link under fraud review; owners, managers and admins
  read the audit log. Live: register → award 25 → adjust +5 → list → audit line →
  clawback 40 → −35.

**Tests: 69 unit, 189 integration, all passing.**

## In progress

Nothing. The last task is finished.

## Blocked

- **Supabase is chosen in practice.** A dev project exists (`eu-north-1`, Free plan) and
  its URL, publishable and secret keys live in `apps/api/.env` (git-ignored). The hosted
  Postgres is migrated. What is still missing: running the built resolver against the
  live project (Next 1). Stripe, the email provider and the hosting providers are still
  open (`docs/DECISIONS.md` D-059); billing and the customer app cannot be built end to
  end until at least Stripe is picked.
- **The offline QR design is not final.** D-022 is still `Proposed`. It is the highest
  technical risk in the MVP and needs an architecture decision before it is built.

## Next

In the order of `AGENT.md` section 13:

1. **Pending customers, manual adjustments in the UI, fraud clawback, audit log**
   (build step 6). The ledger side of adjustments and clawbacks already works.
2. **Billing with Stripe** and the failed-payment states (build step 7).
3. **Offline awarding**: signed QR, device verification, encrypted queue, sync and
   rejections (build step 8). Highest risk, so prototype the QR and sync early.
4. **Reports, hardening, accessibility pass, store submissions** (build step 9).
5. **Discount/campaign engine** — deferred by A until its own design round; the
   activation rule (one per customer / repeatable / owner-set window) is still open.
6. **The rest of FR-CUS**: per-store consents (FR-CUS-5), data export and account
   deletion (FR-CUS-6), the lost-card / new-QR flow (FR-CUS-7), and push (v1.1).

### The next concrete task

The customer app's first slice works. The next build step is **step 6**: register a
customer at the till by email (the pending-customer flow), manual adjustments in
the store UI, fraud clawback, and the audit log. The API's adjustment and clawback
paths already exist; the work is the store-facing screens and the pending-customer
rules.

Still open, deliberately:

- Physical cards: the customer app shows the same opaque identifier the till
  already scans. Whether barcoded cards deserve their own credential type is a
  v1.1 schema question (the FR-CRD-5 round).
- Finnish UI strings, idle auto sign-out and receipt printing — later design work.
- Code sign-in needs `{{ .Token }}` in the Supabase Magic Link template (one-time
  dashboard edit, in the runbook).

## Risks to watch

- **Offline awarding** is the biggest piece and the biggest fraud surface. The server
  re-validates everything at sync; never relax that because the client already checked.
- **Solo workload** across product, design, build, test and support. Hold the MVP scope.
- **Two app stores plus web** add release and review work. Plan accounts and review time
  early.
- **Cold start.** Customers see little value until several stores participate. Launch in
  one tight local cluster.
