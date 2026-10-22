# HANDOFF: BOKPOINTS

Living document. Update it at the end of every working session (see `AGENT.md`, section 14). The newest information goes at the top of "Current state" and in the session log. Keep it short and accurate: someone with no memory of earlier sessions must be able to pick up from here.

Last updated: 21 Oct 2026, end of the first build session. Phase: **build started.**
Build order steps 1 and 2 of `AGENT.md` section 13 are done.

## 1. Read these first, in this order

1. `AGENT.md`: how to work in the repo, the locked stack, and the rules that must never be broken.
2. PRD v0.2: why, for whom, scope by phase.
3. FRD v0.2: what the system does, requirement IDs (`FR-...`), edge cases, acceptance criteria (`AC-1` to `AC-11`).
4. `docs/DECISIONS.md`: why each decision was made, and which ones are still open.

The PRD and FRD are now exported into this repo as `docs/PRD.md` and `docs/FRD.md`, converted
from the source PDFs in `docs/source/`. The export was checked against the PDFs: all 114
`FR-` requirement IDs and `AC-1` to `AC-11` are present and unaltered. If a copy here and
a later edit to the original Claude Doc disagree, the Claude Doc is newer until this repo
is re-exported.

## 2. What BOKPOINTS is, in four lines

- A loyalty platform for small businesses (SMEs) in Finland / EU. Stores pay a monthly subscription; customers use it free (B2B2C).
- A cashier scans the customer's QR code, enters the purchase amount, and the customer earns points at that store. Points are per store, kept in one customer wallet, and expire 3 months after they are earned.
- Three surfaces: customer app (iOS, Android, web), store dashboard with a Cashier screen, and an admin panel.
- One person (A) is product owner, product manager, designer, developer and tester.

## 3. Current state

| Item                     | State                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRD                      | v0.2, exported to `docs/PRD.md`                                                                                                                                                                |
| FRD                      | v0.2, exported to `docs/FRD.md`; open points listed in its section 11                                                                                                                          |
| AGENT.md                 | v0.1; the commands in section 5 are now real, some providers are still placeholders                                                                                                            |
| HANDOFF.md, DECISIONS.md | v0.2 (this file and its companion)                                                                                                                                                             |
| Technology stack         | Locked (see `AGENT.md`, section 3)                                                                                                                                                             |
| Repository               | Created at `~/bokpoints`, private GitHub remote `github.com/AbdKabeer1/bokpoints`                                                                                                              |
| Code                      | Monorepo skeleton, CI, points engine in `packages/shared`, ledger schema and migrations, transactional ledger write path, Fastify API (identify, award, balance, store setup, invites, expiry, `/v1/me`, side-effect-free award preview), the Supabase session resolver (second factor enforced), optional store branches, row-level security on every table, and the Cashier screen in `apps/web` (React + Vite PWA) |
| Tests                     | 56 unit (Vitest) and 142 integration (real local Postgres), all passing                                                                                                                        |
| Accounts (Stripe, Supabase, email provider, hosting, Apple and Google developer accounts) | Supabase: a dev project exists in Stockholm (`eu-north-1`), Free plan. Stripe, the email provider, hosting, a domain, Apple and Google: none confirmed |
| Pilot stores             | None chosen                                                                                                                                                                                    |

## 4. Scope of the MVP (summary)

Admin onboards stores. Stores add staff and set points rules. Cashier scans the customer's QR code and enters the amount, online or offline, with offline awards synced later. Points are per store and expire after 3 months. Customer apps show per-store balances and history. Cashiers can register customers by email. Manual adjustments (never below zero), admin fraud clawback, audit log. Monthly subscription billing with the failed-payment schedule. Email verification and in-app notices.

Not in the MVP: rewards and redemption, products and discounts, campaigns and push, NFC card, wallet passes, POS integrations, gifting, gift cards, SMS, store-level expiry settings, universal points.

## 5. Next steps (in order)

1. **Customer app: sign-up, QR, per-store balances and history, expiry notices**
   (build step 5). `apps/customer` is a stub today.
2. **Pending customers (register by email); manual adjustments in the UI; fraud
   clawback; audit log** (build step 6). The ledger side of adjustments and clawbacks
   already works.
3. **Billing with Stripe and the failed-payment states** (build step 7).
4. **Offline awarding: signed QR, device verification, encrypted queue, sync and
   rejections** (build step 8). Prototype the QR and sync early, because it is the
   highest technical risk.
5. **Reports, hardening, accessibility pass, store submissions** (build step 9).

Build steps 1–4 are done: schema, points engine, ledger, API, live Supabase auth, store
setup with invites, the expiry job, and now the Cashier screen. The session log below and
`handoff/STATUS.md` hold the detail.

Deferred by A, wanting its own design round later: the **discount/campaign engine**
(customer activates an offer, the cashier applies it, the price drops and points are
earned on the reduced price). Its open question — one activation per customer, or
repeatable, or a validity window the owner sets — is parked for that round.

Parallel, non-code tasks for A:

- Choose a pilot area and approach 3 to 5 stores.
- Decide subscription pricing (tiers, trial, setup fee).
- Open the accounts needed (see the table above) and plan app store review time.
- Arrange a legal and privacy review (terms, privacy notice, marketing consent, keeping pending-customer emails for 1 year, points terms).

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
| Build 5    | Supabase auth: the session resolver verifies tokens against the project's public keys and requires a second factor (D-098 to D-101); `auth_user_id` links staff to Supabase users; optional store branches with a database-enforced store match (D-103, D-104); row-level security on every table (D-102); `bootstrap:admin` and `staff:login` scripts (D-105); `dev` reads `.env`. Found and fixed a migration (`0005`) that was missing from the Drizzle journal and added a test for it (D-106). | 45 unit and 111 integration tests pass | Run the resolver against the live Supabase project, then the points expiry job |
| Build 6    | Store setup and the points expiry job: an admin creates the whole store in one call (active store, points rule version 1, optional branches, first owner), owners and managers invite staff with an optional one-branch limit (D-107); `pnpm expiry:run` expires each due batch once, safe the same day and under parallel runs (D-108). Plan: `docs/superpowers/plans/2026-10-22-store-setup-and-expiry.md` | 45 unit and 131 integration tests pass | Run the resolver against the live Supabase project — store creation now makes the first real award testable end to end |
| Build 7    | The Cashier screen, online only: `GET /v1/me` (identity, memberships, the store's branches) and `POST /v1/stores/:storeId/awards/preview`, which returns the points and expiry without writing anything (D-109); `apps/web` is a React + Vite PWA with a keyboard-wedge scan field (no camera), sign-in with a second factor including first-time authenticator enrolment, the store/branch the caller works at, a debounced preview, a confirm step with a fresh idempotency key, and a recorded result with the new balance (D-110). Spec: `docs/superpowers/specs/2026-10-22-cashier-screen.md` | 56 unit and 142 integration tests pass; the whole flow was run live against Supabase (identify `CUST-QR-0001` → Aino, 15 points; preview of €12.50 → 12 points, expiring 22 Jan 2027, balance unchanged) | The customer app (build step 5), or the discount/campaign design round A deferred |
| Build 4    | Implemented the review findings of 22 Oct: `TRUST_PROXY` (off by default) passed to Fastify as `trustProxy`, so the rate limiter keys on the caller behind a load balancer (D-095, D-097); the idempotency race path now refuses a different amount (D-092) instead of replaying the winner; batch drawdowns take `FOR UPDATE` row locks so concurrent adjustments cannot drive a batch negative; the earn rate is bounded by a CHECK at 1,000,000 thousandths (D-093); fixed two misplaced docblocks (`env.ts`, `ledger.ts`); documented the public `/v1/openapi.json` in D-095; corrected the test counts in the handoff documents | 42 unit and 73 integration tests pass                                                                                                         | The Supabase session resolver, then the points expiry job      |
| Build 3    | Fixed the review findings: point batches so an expiry cannot double-deduct, the rule that applies now ignores a rule scheduled for the future, store, staff and customer status checks on the write path, credential state checks on identify, a clean 404 for an unknown customer, a 409 when an idempotency key is reused with a different amount, a cap on the purchase amount, case-insensitive email uniqueness, rate limiting and security headers                                                                                                                                                                             | 42 unit and 53 integration tests pass                                                                                                         | The Supabase session resolver, then the points expiry job      |
| Build 2    | Added the award endpoint with a pluggable session resolver, the identify and balance endpoints, server-side store scoping and permission checks, the OpenAPI document generated from the shared Zod schemas, and the Supabase seam                                                                                                                                                                                                                                                                                                                                                                                                   | 42 unit and 33 integration tests pass. The award endpoint is live but authenticates through the development resolver until Supabase is chosen | The Supabase session resolver, then the points expiry job      |
| Build 1    | Created the repo and the monorepo skeleton with CI; exported the PRD and FRD into `docs/`; built the points engine (calculation, rounding, minimum and maximum rules, expiry, FIFO, balance rules) and the role and capability matrix with unit tests; defined the 13-table schema with migrations and append-only triggers; added the transactional ledger write path with integration tests; added the Fastify skeleton                                                                                                                                                                                                            | Steps 1 and 2 of the build order are done. 39 unit and 13 integration tests pass. Private GitHub remote created                               | Points expiry job, then auth and roles once Supabase is chosen |
| Planning 1 | Brainstormed the product; wrote PRD v0.2, FRD v0.2 and AGENT.md v0.1; answered the FRD decisions; locked the tech stack; created HANDOFF.md and DECISIONS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Planning complete; no repo, no code                                                                                                           | Create the repo and skeleton; build the points engine          |
