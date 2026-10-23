# STATUS

**Project:** BOKPOINTS, a B2B2C loyalty platform for SMEs in Finland / EU.
**Phase:** MVP, worked through `BOKPOINTS The Way Forward.md` one work package at a time. WP0, WP1 and WP2 (store-owned rules) are done. A brought the three surfaces forward before WP3: the till restyle and the owner portal are in, the customer app's first impression is in. **Next up: WP3 — sale record (D-129/131), then the rotating QR (D-133).**
**Last updated:** 23 Oct 2026, after Build 14 (owner portal). Build 13 closed WP2: versioned store-owned rules with supersede-on-edit, pause/resume that really stops awarding, an `every_nth_visit` rule type counted in the ledger, and a simulate endpoint. Build 14 put the first owner UI on top of it (`apps/owner`, D-137). 87 unit and 211 integration tests green. Migrations 0007-0010 are applied locally and still waiting on your word for the hosted database.

## Done

- **Build 14a — component document check.** `UI_and_App_Components_revised.docx` (A's 23 Oct
  revision) is now in the repo and is the source for what each app contains. Every MVP line
  was checked against the code: the result table lives in `docs/HANDOFF.md` section 10.
  Biggest findings: redemption and a rewards catalog are now MVP (D-138), the till needs a
  camera scanner, a payment-confirmation step (WP3), recent awards, scan feedback and
  offline mode; the customer app needs consents, settings, privacy tools and rewards; the
  dashboard needs reports, branches, store profile and billing; the platform console has no
  screens at all yet. Note: the document's "D-125" citation for redemption is a numbering
  slip; it is D-138 here.

- **Build 14 — the owner portal (`apps/owner`, "Poket Merchant Platform", :5174).**
  Sign-in and TOTP identical to the till, four sections. **Rules** is the point-calculation
  control: see every current rule in one line each, create one of the four types, change a
  rule by saving the next version (history stays append-only), pause/resume, and **Try it**
  simulates the draft before it is saved. **Customers**: search, register without the app,
  manual adjustments with an audit reason. **People**: the new `GET /v1/stores/:storeId/staff`
  (invitations not wired yet - they wait on the invite-provider decision D-113). **Audit**:
  the store log with before/after JSON. New shared schemas: `storeStaffMemberSchema`,
  `storeStaffResponseSchema`.

- **Customer app first impression.** A new animated splash (mark, wordmark and
  tagline in sequence, then a fade; skipped when the OS asks for reduced motion) plays
  while the session is checked, then hands off to a rebuilt sign-in page: white page,
  green action, the promise, three benefits, one email field, and a focused-input
  state; the three benefits tick in one after the other as solid green checks. The
  palette is now white/green with the old names aliased, so Home,
  Onboarding and history picked it up too. The customer-facing name is **Poket**
  (D-136), shown as a letter-by-letter animated wordmark with a green dot; the repo,
  packages, API and documents keep BOKPOINTS until a full rename is approved.
- **Till restyle.** `apps/web` moved from dark navy/gold to the same white-and-green
  Poket system: bright surface, 800-weight headings, green primary with soft-mint
  disabled state, green eyebrows, focused-input ring, and the wordmark dot in the
  top bar. Functionality untouched (one stylesheet plus the five brand strings).
  The till identifies as **Poket · STORE PORTAL** (wordmark + small tag on every
  screen, tab title, and the sign-in headline), keeping "Merchant Platform" free
  for the owner console; the customer app stays plain Poket.
- **Till depth pass.** To answer "white and green feels incomplete": the top bar
  became the near-black anchor (white wordmark + mint tag, white store name), a
  three-chip step rail (Find the customer → Add the amount → Confirm the sale)
  tracks the sale state, the amount sits in a money field with a € prefix and
  1.7rem bold figure, earned points render as a mint receipt panel (+N pts / on
  €X · branch · expiry), and the recorded screen is a mint panel with a green
  check badge.
- **Discount, reversal, QR and device decisions (D-129 to D-135).** Recorded in
  `docs/DECISIONS.md` and applied to the PRD and FRD: points on the amount actually paid
  (D-129), the store funds its own discounts and the platform never settles (D-130), one
  automatic discount per sale with no stacking (D-131), POS refunds and voids write a
  bounded, idempotent reversal tied to the sale (D-132, supersedes D-013 for POS), a
  discount needs a rotating one-time QR proof verified online with no offline discounts
  (D-133), plain-ID NFC cards are identification-only (D-134), and devices get their own
  revocable, scoped credentials (D-135). The FRD gained FR-CHK-8/9, FR-SAL-4/5, FR-DEV
  and AC-19 to AC-22, and the parked list shrank accordingly.
- **WP0 — security fixes (Way Forward section 4).** (1) *Invite takeover, high:* the
  invite route used the upsert helper written for the bootstrap script, which overwrites
  name, admin flag and Supabase link — an owner could invite another store's owner or a
  platform admin with an id they control and have the account relinked. The invite path
  now creates an account only when the email is new, otherwise it only adds the store
  membership (409 `ALREADY_MEMBER` if already a member), never touching the existing
  account; a Supabase id linked to another account is refused (409
  `AUTH_USER_ALREADY_LINKED`); admin store creation uses the same path; the overwriting
  helper stays for `bootstrap:admin` only (D-119, AC-14). (2) *Unverified email, medium:*
  a real Supabase access token has **no** confirmation claim (verified by decoding one), so
  provisioning now asks the Auth Admin API for `email_confirmed_at` at the only moment it
  matters — before it would create or claim a row — and fails closed, answering 403
  `EMAIL_NOT_VERIFIED` (D-120, D-127, AC-17). Live check: the hosted database has no staff
  rows; the app database's five staff rows are correct (one admin, links present, no
  duplicates).
- **WP1 — decisions and documents.** PRD: store-owned rules and the one basket discount
  in MVP scope, the checkout moment, the owner persona, pilot measures and pricing as
  hypotheses, new risks and open questions. FRD: section 2 gains the earning-rules
  capability and till registration, section 3 gains the earning-rule, discount-rule and
  sale tables, FR-PTS-1/3 read as a rule set with ceilings, FR-STO-2/4/5 and FR-AUTH-1
  changed, flows 4.1 and 4.3 rewritten as quote-then-confirm, new families FR-RUL, FR-CHK
  and FR-SAL, `AC-12` to `AC-18`, and the parked families documented. DECISIONS:
  `D-115` to `D-128` (the Way Forward's proposed D-113–D-124 renumbered past Build 9's
  D-113/D-114). `docs/HANDOFF.md` now names the Way Forward as the plan of record.
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

**Tests: 85 unit, 200 integration, all passing.**

## In progress

**WP2 — store-owned earning rules.** Working: a store's rules are rows in
`earning_rules` (type, params, conditions, effective date, status, version), and
`packages/shared/src/points/purchase.ts` (`calculatePurchase`) evaluates a basket of
item lines against all active, effective rules — points add up under the store's
per-sale ceiling (`stores.max_points_per_sale`). The award and preview endpoints now
use the rule set, and each award stores its breakdown in
`points_ledger_entries.rules_applied`. Migration `0009` converts every existing
`points_rules` row into a per-euro earning rule and moves the ceiling onto the store;
store creation writes both the legacy row and the new rule.

Still to do in WP2: the owner endpoints (list, create, edit, pause, simulate) with a
`rules.manage` capability and audit entries; the every-Nth-visit rule type; and
removing the transitional fallback that reads `points_rules` when a store has no
earning-rule rows (it covers the test fixtures and any store created by an older
process).

## Blocked

- **Supabase is chosen in practice.** A dev project exists (`eu-north-1`, Free plan) and
  its URL, publishable and secret keys live in `apps/api/.env` (git-ignored). The hosted
  Postgres is migrated, and the built resolver has been run against the live project
  (admin with second factor, store creation, a real award, the expiry job, and an `aal1`
  customer sign-in). The app itself writes to the local `DATABASE_URL`; the hosted
  Postgres holds no data yet. Stripe, the email provider and the hosting providers are
  still open (`docs/DECISIONS.md` D-059); billing cannot be built end to end until at
  least Stripe is picked.
- **The offline QR design is not final.** D-022 is still `Proposed`. It is the highest
  technical risk in the MVP and needs an architecture decision before it is built.

## Next

The order is the Way Forward's work packages (D-128). Finish and record one before
starting the next.

1. **WP2 — store-owned earning rules (backend).** Engine: evaluate a purchase against a
   store's set of rules, item-line basket in, per-euro as one rule type
   (`packages/shared/src/points/`). Data: an earning-rules table (store, type, parameters,
   conditions, effective date, status, version), converting today's `points_rules` rows
   into per-euro rules in the same generated migration. Owner endpoints: list, create,
   edit, pause, simulate, with audit entries; a capability for managing rules (admin gets
   none); points from matching rules add up under a per-sale ceiling; admin store creation
   makes the first rule an optional template.
2. **WP3 — sale record and quote-then-confirm.** The sale records the amount before
   discount, the discount with its rule version, and the amount actually paid; points are
   earned on the amount paid (D-129). One automatic basket threshold discount, no stacking
   (D-131), funded by the store (D-130). The ledger gains `sale_id` and the `reversal_of`
   hook for POS refunds (D-132).
3. **Rotating QR before any discount is enabled** (D-133): signed, about 60 seconds,
   one-time per store, verified online. Static `CUS-` codes keep earning points; no
   discount is awarded offline.
4. **WP4 — cashier screen:** quote, payment taken, confirm with the amount actually paid,
   sound and visual on a successful read, and a clear "discount needs a fresh scan" path.
5. **WP5 — owner screen:** rules with the simulator, plus adjustments and the store audit
   log — this is where Build 6B (the store and admin panels) lands (D-128).
6. **WP6 — customer app:** each store's rules in plain language, and the session moved to
   secure storage.
7. **WP7 — pilot readiness:** domain and email sender, email invitations (retiring the
   Supabase-id field), subscription billing and the pricing meter, terms and privacy,
   signage and a scanner list. **WP8 — the pilot:** two or three stores, about four weeks.

Built with the POS adapter, once a pilot store names its POS: refunds and voids as
bounded, idempotent reversals (D-132) and per-device credentials in `cashier_devices`
(D-135). WP3 lays the hooks so neither needs a rewrite.

Not scheduled by the plan of record but still MVP — raise with A before it slips:

- **Offline awarding** (build step 8): signed QR, device verification, encrypted queue,
  sync and rejections. Highest technical risk; prototype early.
- **The rest of FR-CUS:** per-store consents (FR-CUS-5), data export and account
  deletion (FR-CUS-6), the lost-card / new-QR flow (FR-CUS-7), push (v1.1).

Small Way Forward 4.4 items recorded here so they are not lost:

- **Customer app session storage:** move from plain AsyncStorage to secure storage before
  any store release. Blocked on a design choice: `expo-secure-store` has no web build and
  the customer app currently ships web, so it needs a platform-specific storage layer —
  part of WP6.
- **Till idle sign-out:** an idle cashier session should sign out (`apps/web/src/auth.ts`).
  Small; fold into WP4 when the till is rewritten for quote-then-confirm.
- **Prettier (or equivalent) on changed files:** CI does not enforce formatting.
- Confirm the latest GitHub Actions run is green.

Still open, deliberately:

- Physical cards: the customer app shows the same opaque identifier the till
  already scans. Whether barcoded cards deserve their own credential type is a
  v1.1 schema question (the FR-CRD-5 round).
- Finnish UI strings and receipt printing — later design work.
- Code sign-in needs `{{ .Token }}` in the Supabase Magic Link template (one-time
  dashboard edit by A), and "Confirm email" must stay on — WP0's check depends on it.

## Risks to watch

- **Offline awarding** is the biggest piece and the biggest fraud surface. The server
  re-validates everything at sync; never relax that because the client already checked.
- **Solo workload** across product, design, build, test and support. Hold the MVP scope.
- **Two app stores plus web** add release and review work. Plan accounts and review time
  early.
- **Cold start.** Customers see little value until several stores participate. Launch in
  one tight local cluster.
