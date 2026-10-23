# HANDOFF: BOKPOINTS

Living document. Update it at the end of every working session (see `AGENT.md`, section 14). The newest information goes at the top of "Current state" and in the session log. Keep it short and accurate: someone with no memory of earlier sessions must be able to pick up from here.

Last updated: 23 Oct 2026, after WP0 and WP1 of `BOKPOINTS The Way Forward.md`. Phase: **build, WP2 next.**
The Way Forward is the plan of record (D-128): WP0 security and WP1 documents are done; WP2 (store-owned earning rules) starts next.

## 1. Read these first, in this order

1. `BOKPOINTS The Way Forward.md`: the plan of record — MVP boundary, parking lot, and the work packages WP0 to WP8.
2. `AGENT.md`: how to work in the repo, the locked stack, and the rules that must never be broken.
3. PRD: why, for whom, scope by phase.
4. FRD: what the system does, requirement IDs (`FR-...`), edge cases, acceptance criteria (`AC-1` to `AC-18`).
5. `docs/DECISIONS.md`: why each decision was made, and which ones are still open.

The PRD and FRD were exported from the source PDFs in `docs/source/` and checked
(`AC-1` to `AC-11` present and unaltered). Both have since been edited in this repo to
apply the Way Forward (store-owned rules, quote-then-confirm, the sale record, FR-RUL,
FR-CHK, FR-SAL, `AC-12` to `AC-18`), so the repo copy is now the newer one.

## 2. What BOKPOINTS is, in four lines

- A loyalty platform for small businesses (SMEs) in Finland / EU. Stores pay a monthly subscription; customers use it free (B2B2C).
- A cashier scans the customer's QR code, enters the purchase amount, and the customer earns points at that store. Points are per store, kept in one customer wallet, and expire 3 months after they are earned.
- Three surfaces: customer app (iOS, Android, web), store dashboard with a Cashier screen, and an admin panel.
- One person (A) is product owner, product manager, designer, developer and tester.

## 3. Current state

| Item                     | State                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRD                      | v0.2 + Way Forward (section 6) in `docs/PRD.md`: store-owned rules and one basket discount in the MVP, checkout described as quote-then-confirm, pilot measures, pricing tiers as hypotheses     |
| FRD                      | v0.2 + Way Forward (section 7) in `docs/FRD.md`: new families FR-RUL, FR-CHK, FR-SAL; changed requirements in PTS, STO, AUTH; `AC-12` to `AC-18`; parked families documented, not scheduled     |
| AGENT.md                 | v0.1; the commands in section 5 are now real, some providers are still placeholders                                                                                                            |
| HANDOFF.md, DECISIONS.md | v0.2 (this file and its companion)                                                                                                                                                             |
| Technology stack         | Locked (see `AGENT.md`, section 3)                                                                                                                                                             |
| Repository               | Created at `~/bokpoints`, private GitHub remote `github.com/AbdKabeer1/bokpoints`                                                                                                              |
| Code                      | Monorepo skeleton, CI, points engine in `packages/shared`, ledger schema and migrations, transactional ledger write path, Fastify API (identify, award, balance, store setup, invites, expiry, `/v1/me`, side-effect-free award preview), the Supabase session resolver (second factor enforced), optional store branches, row-level security on every table, the Cashier screen in `apps/web` (React + Vite PWA), the customer API plus the Expo customer app in `apps/customer` (an animated white-and-green intro, a rebuilt sign-in landing page, then the QR, per-store balances, history and expiring notices), the store actions — register a customer by email, adjust a balance, admin clawback, read the audit log — and WP0: invites that never alter an existing account (D-119) and a verified email required before a customer account is created or claimed (D-120, D-127) |
| Tests                     | 85 unit (Vitest) and 200 integration (real local Postgres), all passing                                                                                                                        |
| Accounts (Stripe, Supabase, email provider, hosting, Apple and Google developer accounts) | Supabase: a dev project exists in Stockholm (`eu-north-1`), Free plan. Stripe, the email provider, hosting, a domain, Apple and Google: none confirmed |
| Plan of record            | `BOKPOINTS The Way Forward.md` (D-128): MVP boundary, parking lot, WP0–WP8. Its proposed D-113–D-124 are recorded here as D-115–D-126                                                                  |
| Pilot stores             | None chosen                                                                                                                                                                                    |

## 4. Scope of the MVP (summary)

Admin onboards stores. Stores add staff and **create their own earning rules** (points per euro, fixed points per purchase, threshold bonus, optionally every-Nth-visit) with a simulator before activation, plus **one basket threshold discount** applied at the till (D-115, D-116). Checkout is **quote then confirm after payment**: the quote shows the points and any discount, and points are awarded when the cashier confirms payment and enters the amount paid (D-123); every award belongs to a sale record (D-118). Cashier scans the customer's QR code (camera or a countertop scanner that types like a keyboard), online or offline, with offline awards synced later. Points are per store and expire after 3 months. Customer apps show per-store balances and history. Cashiers can register customers by email. Manual adjustments (never below zero), admin fraud clawback, audit log. Monthly subscription billing with the failed-payment schedule. Email verification and in-app notices.

**Parked until its trigger is met** (Way Forward, section 3): POS integration and terminal APIs, product catalog and product-level rules and discounts, automatic terminal discounts, opt-in campaigns, NFC card reading and wallet passes, accumulated spend thresholds, and card-linked payments. Promoted out of the parking lot by D-132–D-135: POS refunds and voids (reversal tied to the sale), device credentials, and signed rotating QR codes (required before any discount). Outside the parking lot but still MVP and not yet scheduled by the WP list: offline awarding, and the rest of FR-CUS (consents, export and deletion, lost card / new QR).

## 5. Next steps (in order)

The order is the Way Forward's work packages (D-128). One package is finished and
recorded before the next starts.

1. **WP0 — security fixes.** Done (this session): invites never alter an existing
   account (D-119); a verified email before a customer account is created or claimed
   (D-120, D-127). Live data checked.
2. **WP1 — decisions and documents.** Done (this session): PRD, FRD, DECISIONS
   (D-115 to D-128), this file and `handoff/STATUS.md`.
3. **WP2 — store-owned earning rules (backend).** *In progress, more than half done:*
   the engine (`calculatePurchase`), the `earning_rules` table, migration `0009` that
   converts every `points_rules` row into a per-euro rule and moves the ceiling onto the
   store, and the wiring of award and preview to the rule set with the breakdown stored on
   every award. Next: owner endpoints (list, create, edit, pause, simulate) with a
   `rules.manage` capability and audit, the every-Nth-visit rule type, and removing the
   transitional `points_rules` fallback.
4. **WP3 — sale record and quote-then-confirm.** The sale carries the amount before
   discount, the discount and the amount actually paid, and points are earned on the
   amount actually paid (D-129). One automatic basket threshold discount, no stacking
   (D-131), funded by the store (D-130). The ledger gains `sale_id` and a `reversal_of`
   hook for POS refunds (D-132).
5. **Rotating QR, before any discount is enabled.** Signed, short-lived (about 60 s),
   one-time-per-store, verified online (D-133). Static `CUS-` codes keep earning points
   in the meantime; no discount is awarded offline.
6. **WP4 — cashier screen** (quote, payment, confirm, sound and visual on read, and a
   clear "discount needs a fresh scan" path). **WP5 — owner screen** (rules with
   simulator, plus adjustments and the store audit log: Build 6B lands here, D-128).
   **WP6 — customer app** shows each store's rules in plain language.
8. **WP7 — pilot readiness:** domain and email sender, email invitations (retires the
   Supabase-id field), subscription billing and the pricing meter, terms and privacy,
   signage and a scanner list. 9. **WP8 — pilot:** two or three stores, about four
   weeks, recording what they ask for.

Decided but built with the POS adapter (when a pilot store names its POS): POS refunds
and voids as bounded, idempotent reversals tied to the sale (D-132), and per-device
credentials for terminals and cameras in `cashier_devices` — hashed secret, store/branch
bound, scopes identify/quote/confirm/reversal, revocable, rate-limited, audited (D-135).
The sale record in WP3 lays the hooks so neither needs a rewrite.

Not scheduled by the plan of record, still MVP — raise with A before it slips:
**offline awarding** (build step 8, highest technical risk) and the **rest of FR-CUS**
(consents, data export and deletion, lost card / new QR).

Deferred by A, wanting its own design round later: the **discount/campaign engine**
(customer activates an offer, the cashier applies it, the price drops and points are
earned on the reduced price). Its open question — one activation per customer, or
repeatable, or a validity window the owner sets — is parked for that round. The Way
Forward's parking lot now governs it too: campaigns build when several stores ask.

Parallel, non-code tasks for A:

- Choose the pilot area and approach two or three stores.
- Decide the pricing tiers (D-126 proposes 19/39/69 EUR by active customers), the
  domain name and who owns the email sender account.
- Open the accounts needed (see the table above) and plan app store review time.
- Arrange a legal and privacy review (terms, privacy notice, marketing consent, keeping
  pending-customer emails for 1 year, points terms).

## 6. Open questions

Confirmed by A (no longer open):

- **Expiry:** each batch of points expires 3 months after it was earned.
- **Paused (day 14):** no changes to campaigns, rewards, products or rules, while awarding continues.
- **Manual removal:** owners and managers can remove points by adjustment, never below zero.

Still open:

1. Offline limits: cap per offline award, queue size, credential validity (proposed: about 7 days), and the one-time proof lifetime (proposed: about 1 minute).
2. Fraud clawback process: who decides a case, what the case note holds.
3. Privacy basis for keeping a pending customer's email for 1 year.
4. Expiry reminder window (proposed: 14 days).
5. Subscription pricing and plans; whether NFC cards are charged separately.
6. Points earn-rate defaults and redemption options for v1.1.
7. Hosting and email providers.
8. Which POS systems the pilot stores use.
9. How SMS costs are handled when SMS is added later (fees are normally billed to the sender).

## 7. Risks to watch

- **Offline awarding** adds complexity and fraud exposure. Build the online flow first, prototype the offline QR and sync early, and keep server-side validation at sync.
- **Solo workload** across product, design, build, test and support. Hold the MVP scope.
- **Two app stores plus web** add release and review work. Plan accounts and review time early.
- **Cold start:** customers see value only when several nearby stores take part. Launch in one tight area.
- **NFC and wallet passes** depend on third-party approval and hardware. They are v1.1 and v2.
- **Privacy and marketing rules** must be right from the first release.

## 8. How to resume a session

1. Read the four documents in section 1.
2. Read the newest session log entry below, and "Current state".
3. State the task, which FRD requirements it covers, and your plan before touching code (see `AGENT.md`, section 14).
4. At the end, update this file and `docs/DECISIONS.md`.

## 9. Session log

Newest first. One entry per session. Keep each entry to a few lines.

| Session    | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | State at the end                                                                                                                              | Next                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Build 12   | Customer app first impression: an animated splash (green mark, wordmark and tagline arriving in sequence, then a fading hand-off; skipped under reduced motion) that runs alongside the session check, then a rebuilt sign-in page in a white-and-green palette — wordmark, promise, three benefits, email field and one green action, with a centred 460 px column on the web and a focused-input state. The palette in `theme.ts` became white/green with semantic names (`green`, `greenSoft`, `onGreen`, `ink`) and the old `gold` names kept as aliases, so every screen picked up the brand at once. Functionality is unchanged (same email one-time code calls) | 85 unit and 200 integration tests pass; `expo export --platform web` succeeds | WP2 owner endpoints, then WP3 |
| Build 11   | Decisions D-129 to D-135 recorded and applied to the PRD/FRD (points on the amount actually paid, store-funded discounts, no stacking, POS reversals tied to the sale, rotating QR before any discount, plain-ID cards identification-only, device credentials). WP2 build: the multi-rule purchase engine (10 unit tests), the `earning_rules` table, migration `0009` converting every `points_rules` row into a per-euro rule and moving the per-sale ceiling onto the store, and award/preview now evaluate the rule set and store the breakdown (`points_ledger_entries.rules_applied`); 5 integration tests prove rules add up, the ceiling caps, paused/future rules are skipped, the legacy row still works, and a store with no rules is refused 409 | 85 unit and 200 integration tests pass | WP2 owner endpoints, then WP3 sale record |
| Build 10   | WP0 and WP1 of `BOKPOINTS The Way Forward.md`. **WP0:** invites can no longer alter an existing staff account — the invite path creates an account only for a new email, otherwise adds the store membership (409 `ALREADY_MEMBER` if already a member) and never touches name, admin flag or Supabase link; a Supabase id linked elsewhere is refused (409), store creation uses the same path, and the overwriting helper is reserved for the bootstrap script (D-119). Customer provisioning now requires a verified email: the token carries no confirmation claim (verified against a real token), so provisioning asks the Auth Admin API for `email_confirmed_at` only at create or claim time and fails closed (D-120, D-127), refusing with 403 `EMAIL_NOT_VERIFIED`. Also fixed the unindented transaction block in `customers.ts` (4.4). **WP1:** PRD, FRD (FR-RUL, FR-CHK, FR-SAL, `AC-12`–`AC-18`, parking lot), DECISIONS `D-115`–`D-128`, this file and `handoff/STATUS.md`. Plan: `docs/superpowers/plans/2026-10-23-way-forward-wp0-wp1.md` | 75 unit and 195 integration tests pass; live check: the hosted database has no staff rows, the app database's 5 staff rows are correct (one admin, correct links, no duplicates) | **WP2: store-owned earning rules (backend)** |
| Build 5    | Supabase auth: the session resolver verifies tokens against the project's public keys and requires a second factor (D-098 to D-101); `auth_user_id` links staff to Supabase users; optional store branches with a database-enforced store match (D-103, D-104); row-level security on every table (D-102); `bootstrap:admin` and `staff:login` scripts (D-105); `dev` reads `.env`. Found and fixed a migration (`0005`) that was missing from the Drizzle journal and added a test for it (D-106). | 45 unit and 111 integration tests pass | Run the resolver against the live Supabase project, then the points expiry job |
| Build 6    | Store setup and the points expiry job: an admin creates the whole store in one call (active store, points rule version 1, optional branches, first owner), owners and managers invite staff with an optional one-branch limit (D-107); `pnpm expiry:run` expires each due batch once, safe the same day and under parallel runs (D-108). Plan: `docs/superpowers/plans/2026-10-22-store-setup-and-expiry.md` | 45 unit and 131 integration tests pass | Run the resolver against the live Supabase project — store creation now makes the first real award testable end to end |
| Build 7    | The Cashier screen, online only: `GET /v1/me` (identity, memberships, the store's branches) and `POST /v1/stores/:storeId/awards/preview`, which returns the points and expiry without writing anything (D-109); `apps/web` is a React + Vite PWA with a keyboard-wedge scan field (no camera), sign-in with a second factor including first-time authenticator enrolment, the store/branch the caller works at, a debounced preview, a confirm step with a fresh idempotency key, and a recorded result with the new balance (D-110). Spec: `docs/superpowers/specs/2026-10-22-cashier-screen.md` | 56 unit and 142 integration tests pass; the whole flow was run live against Supabase (identify `CUST-QR-0001` → Aino, 15 points; preview of €12.50 → 12 points, expiring 22 Jan 2027, balance unchanged) | The customer app (build step 5), or the discount/campaign design round A deferred |
| Build 8    | The customer app's first slice: `customers.auth_user_id` (migration 0007) with email-claim provisioning and a `CUS-` QR credential, a separate `aal1` customer resolver, and five customer-scoped endpoints — profile (get/patch), stores with balances, per-store history with the true balance after each entry, and points expiring within 14 days (D-111). `apps/customer` is an Expo app with a web export: email one-time code, mandatory first name, a home screen that opens on the QR, the expiring notice, store balances and history (D-112). Design: `docs/superpowers/specs/2026-10-23-customer-app-design.md`; plan: `docs/superpowers/plans/2026-10-23-customer-app.md` | 67 unit and 166 integration tests pass; live against Supabase an `aal1` customer token provisioned a customer and credential, and a €12.50 award at Kahvila Bea appeared as 12 points in the customer's stores and history | The rest of FR-CUS (consents, export/delete, lost card, push), then build step 6 |
| Build 9    | Pending customers and oversight (6A): a cashier registers a customer by email at the till, and the points become theirs on first sign-in because a pending customer is just an unlinked row (D-113). Owners and managers adjust a balance with a required reason and never below zero; admins claw back, which may go negative and marks the store link under fraud review; store and platform audit reads are read-only (D-114). The till gains the "customer without the app" form. Design: `docs/superpowers/specs/2026-10-23-pending-customers-and-adjustments.md`; plan: `docs/superpowers/plans/2026-10-23-pending-customers-and-adjustments.md` | 69 unit and 189 integration tests pass; live: registered a walk-in, awarded 25 points, adjusted +5, found them in the list, read the audit line, clawed back 40 to −35 | The store and admin screens (6B), then build step 7 |
| Build 4    | Implemented the review findings of 22 Oct: `TRUST_PROXY` (off by default) passed to Fastify as `trustProxy`, so the rate limiter keys on the caller behind a load balancer (D-095, D-097); the idempotency race path now refuses a different amount (D-092) instead of replaying the winner; batch drawdowns take `FOR UPDATE` row locks so concurrent adjustments cannot drive a batch negative; the earn rate is bounded by a CHECK at 1,000,000 thousandths (D-093); fixed two misplaced docblocks (`env.ts`, `ledger.ts`); documented the public `/v1/openapi.json` in D-095; corrected the test counts in the handoff documents | 42 unit and 73 integration tests pass                                                                                                         | The Supabase session resolver, then the points expiry job      |
| Build 3    | Fixed the review findings: point batches so an expiry cannot double-deduct, the rule that applies now ignores a rule scheduled for the future, store, staff and customer status checks on the write path, credential state checks on identify, a clean 404 for an unknown customer, a 409 when an idempotency key is reused with a different amount, a cap on the purchase amount, case-insensitive email uniqueness, rate limiting and security headers                                                                                                                                                                             | 42 unit and 53 integration tests pass                                                                                                         | The Supabase session resolver, then the points expiry job      |
| Build 2    | Added the award endpoint with a pluggable session resolver, the identify and balance endpoints, server-side store scoping and permission checks, the OpenAPI document generated from the shared Zod schemas, and the Supabase seam                                                                                                                                                                                                                                                                                                                                                                                                   | 42 unit and 33 integration tests pass. The award endpoint is live but authenticates through the development resolver until Supabase is chosen | The Supabase session resolver, then the points expiry job      |
| Build 1    | Created the repo and the monorepo skeleton with CI; exported the PRD and FRD into `docs/`; built the points engine (calculation, rounding, minimum and maximum rules, expiry, FIFO, balance rules) and the role and capability matrix with unit tests; defined the 13-table schema with migrations and append-only triggers; added the transactional ledger write path with integration tests; added the Fastify skeleton                                                                                                                                                                                                            | Steps 1 and 2 of the build order are done. 39 unit and 13 integration tests pass. Private GitHub remote created                               | Points expiry job, then auth and roles once Supabase is chosen |
| Planning 1 | Brainstormed the product; wrote PRD v0.2, FRD v0.2 and AGENT.md v0.1; answered the FRD decisions; locked the tech stack; created HANDOFF.md and DECISIONS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Planning complete; no repo, no code                                                                                                           | Create the repo and skeleton; build the points engine          |
