# AGENT.md: BOKPOINTS

Instructions for AI coding agents working in this repository. Read this file fully before changing anything. Version 0.1, written against PRD v0.2 and FRD v0.2.

## 1. What this project is

BOKPOINTS is a B2B2C loyalty platform for small businesses (SMEs) in Finland / EU.

- Stores pay a monthly subscription. Customers use the product for free.
- A cashier scans a customer's QR code at the till, enters the purchase amount, and the customer earns points **at that store**. Points are per store; a customer sees one balance per store in one wallet.
- Three surfaces: **customer app** (iOS, Android, web), **store dashboard** (including the Cashier screen), **admin panel**.
- One person (the product owner, "A") is product manager, product owner, designer, developer and tester. You are an assistant. A decides scope and priorities.

## 2. Source of truth

| Question | Where to look |
| --- | --- |
| Why, for whom, scope by phase | PRD (v0.2) |
| What the system must do, rules, flows, acceptance criteria | FRD (v0.2). Requirements have IDs like `FR-PTS-4` and `AC-9` |
| How to work in the code | This file |
| What happened last, what is next | `docs/HANDOFF.md` (create it if missing) |
| Why a decision was made | `docs/DECISIONS.md` (create it if missing) |

Rules:

- If your task conflicts with the FRD, **stop and ask**. Do not silently change a rule.
- If the FRD is silent, ask, or propose a default and record it in `docs/DECISIONS.md`.
- Reference FRD IDs in commit messages, tests and code comments where it helps (for example `FR-PTS-10`).
- Current phase is **MVP**. Do not build v1.1 or v2 features (rewards and redemption, products and discounts, campaigns, push, NFC card, wallet passes, POS integrations, gifting, gift cards, SMS) unless A asks in the current task.

## 3. Locked technology stack

Pin exact versions in `package.json`. Before using an API of any library, check its current documentation; do not rely on memory of older versions.

| Layer | Choice |
| --- | --- |
| Language | TypeScript, strict mode, everywhere |
| Repo | pnpm monorepo |
| Customer app | Expo (React Native) with web export. One codebase for iOS, Android and web |
| Store dashboard, Cashier screen, admin | One React + Vite web app, installable as a PWA (service worker and IndexedDB for the offline queue) |
| API | Node + Fastify, Zod validation, OpenAPI spec, versioned (`/v1`) |
| Database | PostgreSQL in an EU region, Drizzle ORM and Drizzle migrations |
| Auth | Supabase Auth: email one-time codes for customers; password plus MFA for staff and admins |
| QR security | Ed25519 signatures using a vetted library (noble). Never hand-rolled crypto |
| Billing | Stripe Billing and Stripe Tax |
| Email | A transactional email provider with EU data processing (provider not chosen yet) |
| Testing | Vitest, Playwright |
| Monitoring | Sentry |
| CI | GitHub Actions |
| Hosting | API on an EU container host; web on a static host (providers not chosen yet) |

Do not add a new framework, database, auth system or major dependency without A's approval. For small dependencies, state why in the PR and prefer well-maintained packages.

## 4. Repository layout

Target structure. Create it as needed; keep it consistent.

```
/
  apps/
    api/            Fastify API
    web/            Store dashboard, Cashier screen, admin (React + Vite PWA)
    customer/       Expo app (iOS, Android, web)
  packages/
    shared/         Types, Zod schemas, points maths, expiry logic, QR verification
    ui/             Shared design tokens and components (if shared across apps)
    config/         Shared tsconfig, eslint, prettier
  docs/
    PRD.md  FRD.md  HANDOFF.md  DECISIONS.md
  AGENT.md
```

Key principle: **business logic lives in `packages/shared` as pure functions** (no I/O). The API and the offline Cashier screen must use the same code for points calculation and QR verification so they cannot disagree.

## 5. Commands

These are the intended commands. They do not exist until the first setup task creates them. When you add or change a script, update this section in the same change.

```
pnpm install            install dependencies
pnpm dev                run everything locally
pnpm typecheck          TypeScript checks across the repo
pnpm lint               lint
pnpm test               unit tests (Vitest)
pnpm test:integration   tests against a real local Postgres
pnpm test:e2e           Playwright end-to-end tests
pnpm db:migrate         apply database migrations
pnpm db:generate        generate a migration from schema changes
```

Never say a task is done unless typecheck, lint and the relevant tests pass, or you state clearly which checks you could not run and why.

## 6. Domain rules (invariants)

These must hold at all times. They come from the FRD. Never weaken them to make a test or a feature easier.

1. **Per-store points.** Points belong to the store that issued them and are never usable at another store.
2. **Append-only ledger.** Ledger entries are never updated or deleted. Types: `earn`, `redeem` (v1.1), `adjust`, `expire`, `fraud_clawback`. A balance is the sum of ledger entries for that customer and store.
3. **No reversals.** There is no undo or reverse feature. Mistakes are fixed by an `adjust` entry made by an owner or manager, with a required reason.
4. **No negative balances**, except an admin-only `fraud_clawback`. Adjustments that would take a balance below zero must be refused.
5. **Expiry.** Points expire 3 months after the day they were earned. Each `earn` entry stores its expiry date and remaining points. Oldest points are used first (FIFO). A daily job writes `expire` entries. Expiry for an offline award counts from its scan time.
6. **Money and points are integers.** Store money as whole cents in euros. Points are whole numbers. No floating point in money or points maths. Default rounding is round down.
7. **Idempotency.** Every award request carries an idempotency key. Retrying must never award twice.
8. **Atomic writes.** The ledger entry and the balance update happen in one database transaction.
9. **Confirm before awarding.** The Cashier screen shows the amount and the points before the cashier confirms. There is no undo afterwards.
10. **Cashier scans the customer.** Never the other way around. Points are calculated from the amount entered by the store.
11. **Store isolation.** A store can only see and change its own customers' data and its own data. Enforce on the server, in every query.
12. **Server-side authorization.** Every endpoint checks the role and the store. Hiding a button in the UI is never access control. Roles: admin, store owner, store manager, cashier, customer (see the FRD permissions table).
13. **Audit log.** Store creation and status changes, staff changes, rule changes, adjustments, fraud clawbacks, credential and device changes, rejected offline awards and admin support actions are written to an audit log that the product cannot edit or delete.
14. **Billing states.** Failed payment: reminder at day 7, store Paused at day 14 (cannot change campaigns, rewards, products or rules; awarding continues), Suspended at day 30 (cannot award; dashboard read-only except billing). Customers always keep read access to their balances. Paying restores the store at once.

Points calculation default: `points = floor(amountCents * pointsPerEuro / 100)`, applying the store's minimum purchase and maximum-per-transaction rules. Use an integer representation for `pointsPerEuro` (for example thousandths) so there is no floating point. Cover it with tests, including the FRD example: 1 point per euro and 23.80 euros gives 23 points.

## 7. Offline awarding (highest technical risk)

The Cashier screen must award points without a connection (`FR-STO-23`, `FR-CRD-2`, `FR-PTS-11`, `FR-PTS-12`, section 4.8 of the FRD).

- Prototype this first, before building the rest of the cashier flow: a phone shows a signed QR, a browser PWA verifies it with no network, and the award is queued and synced.
- Proposed QR design (to be confirmed in the architecture work; record the final design in `docs/DECISIONS.md`): a credential signed by the platform (customer, credential, the phone's public key, valid about 7 days, refreshed when the app is online) plus a one-time proof made by the phone (valid about 1 minute). The cashier device verifies both locally.
- The offline queue lives in IndexedDB, is encrypted, survives restarts and reboots, and retries with backoff until the server confirms each item.
- At sync the **server re-validates everything**: credential valid at scan time, store not suspended at scan time, proof not used before (per store, across devices), amount within offline limits, idempotency key unseen. Rejected awards go to the rejected-awards list and never to the ledger.
- Show the cashier the sync state at all times. Never show a balance as current when offline.
- Never remove or relax server-side validation because the client "already checked".
- Limits (cap per offline award, queue size, credential validity) are proposals. Make them configuration, not constants buried in code.

## 8. Security rules

- No secrets in the repo, in client bundles or in logs. Use environment variables and the host's secret store. Provide `.env.example` with names only.
- Apps never query the database directly. All access goes through the API. If Supabase's client-side data API is available, keep it disabled for application tables, or enable row-level security with no client policies.
- Validate every input with Zod, on the server, for every endpoint. Reject unknown fields.
- Rate-limit authentication, scanning and awarding endpoints, per user, per device and per IP.
- Store tokens on phones in secure storage (Keychain and Keystore through Expo SecureStore). Never in plain local storage or logs.
- Staff and admin accounts use MFA. Customers use email one-time codes.
- Use only vetted cryptography libraries. Do not design your own scheme or primitive.
- Encrypt offline data on cashier devices. Keep only what the till needs; no customer list on the device.
- Payment card data never touches BOKPOINTS. Stripe handles it.
- Log structured events without personal data (no emails, names or tokens in logs).
- Dependencies: pin exact versions, commit the lockfile, review what you add, run the audit command in CI, and keep dependencies current.
- When unsure whether something is safe, stop and ask. Do not guess on security.

## 9. Privacy and compliance (Finland / EU)

This is a working summary, not legal advice. A will arrange a legal review before launch.

- GDPR applies. Collect only the data needed. Host data in the EU.
- Marketing consent is separate from terms, off by default, recorded per store, and withdrawable.
- Customers can export their data and delete their account. On deletion, remove personal data and keep ledger entries in anonymized form.
- Unclaimed pending-customer records (including the email address) are deleted after 1 year.
- Points have no cash value; terms state the 3-month expiry.
- Invoices show correct Finnish VAT treatment (Stripe Tax).
- No SMS in the MVP. Verification and billing messages go by email; customer notices are in-app.
- Never use real customer data in tests, seeds or screenshots.

## 10. Code conventions

- TypeScript strict. No `any` without a comment explaining why. Prefer `unknown` and narrowing.
- Share Zod schemas between API and clients through `packages/shared`; derive types from schemas.
- Small, pure, testable functions. Side effects at the edges.
- Typed error results for expected failures (for example expired code, suspended store, below-zero balance). Each maps to a clear message in the UI.
- Database changes only through Drizzle migrations. Never edit a migration that has been applied. Never run destructive operations on the ledger or audit tables.
- Names: `camelCase` variables and functions, `PascalCase` types and components, `kebab-case` files. Money fields end in `Cents`.
- Comments explain why, not what. Reference FRD IDs for non-obvious rules.
- Keep changes small and focused. One concern per pull request.
- Commit messages: imperative, short, with the FRD ID when relevant (for example `Add earn-points endpoint (FR-PTS-1, FR-PTS-4)`).
- Never use `--no-verify`, never force-push to `main`, never disable a test, a lint rule or a type check to get a change through.

## 11. UI and UX rules

- Mobile-first and responsive. Test on a small phone, a large phone, a tablet and a desktop browser.
- The Cashier screen is the most important screen: large tap targets, one clear action at a time, instant feedback, a clear success, "Saved offline" or error state (`FR-STO-10`). Optimize for speed at a busy till.
- The customer home screen opens straight to the QR code.
- Every screen has loading, empty and error states.
- Finnish and English from day one. No hardcoded user-facing strings; use translation files. Euro currency, Finnish number and date formats.
- Accessibility: follow WCAG 2.1 AA practices (contrast, tap targets, labels, focus order, screen reader support).
- Use shared design tokens and components. Do not invent one-off styles.

## 12. Testing

Write tests with the code, not after.

- **Unit (Vitest):** points calculation, rounding, minimum and maximum rules, expiry and FIFO, balance rules, QR verification, permissions logic.
- **Integration (real Postgres):** award flow, idempotency, atomic ledger writes, store isolation, adjustments, fraud clawback, expiry job, billing state effects, sync of offline awards.
- **End to end (Playwright):** admin onboarding, customer sign-up, scan and award, offline award and sync, suspended store.
- Map FRD acceptance criteria `AC-1` to `AC-11` to named tests, and keep that mapping current.
- For bugs: write a failing test first, then fix.
- A manual test checklist is kept in `docs/` and run before each release.

## 13. Build order for the MVP

A suggested order. A may change it.

1. Repo setup, CI, shared package, database schema and migrations.
2. Points engine in `packages/shared` and the ledger in the API, with full unit and integration tests.
3. Auth and roles; admin store onboarding; store setup and staff.
4. Cashier screen, online flow only, with confirm step.
5. Customer app: sign-up, QR, per-store balances and history, expiry notices.
6. Pending customers (register by email); manual adjustments; fraud clawback; audit log.
7. Billing with Stripe and the failed-payment states.
8. Offline awarding: signed QR, device verification, encrypted queue, sync and rejections. (Prototype the QR and sync early; finish it here.)
9. Reports, hardening, accessibility pass, store submissions.

## 14. How to work with A

- For any non-trivial task, start with a short plan: files you will touch, risks, and how you will test it. Wait for a go-ahead on large or risky changes.
- Ask when requirements are ambiguous, or when a change affects the invariants in section 6 or the security rules in section 8.
- Do not expand scope. If you notice a useful extra, list it at the end instead of building it.
- Say plainly what you ran and what you did not run. Never claim a test passed without running it.
- Never guess at current API details of third-party services. Check their documentation.
- **At the end of every session**, update `docs/HANDOFF.md` (what was done, current state, what is next, blockers) and add any new decision to `docs/DECISIONS.md`.

## 15. Definition of done

A change is done when:

- It meets the linked FRD requirement and acceptance criteria.
- Typecheck, lint and tests pass, with new tests for new behavior.
- No invariant from section 6 and no rule from section 8 is weakened.
- Permissions are enforced on the server and tested.
- User-facing text is translated (Finnish and English).
- Docs are updated: this file if conventions or commands changed, `docs/HANDOFF.md`, and `docs/DECISIONS.md` if a decision was made.
- Nothing contains secrets or real personal data.

## 16. Known unknowns

Do not invent answers to these. Ask A, or record a proposal in `docs/DECISIONS.md`.

- Hosting providers (API host, static host) and the email provider.
- Final QR credential design, offline limits and credential validity period.
- Subscription pricing and plans.
- Points earn-rate defaults and the redemption options for v1.1.
- Fraud clawback process (who decides, what the case note holds).
- Privacy review of keeping pending-customer email addresses for 1 year.
- Expiry reminder window for customers (proposed: 14 days).
- App store developer accounts and review lead time.

## 17. Glossary

- **SME:** small or medium-sized enterprise, the paying customer.
- **Credential:** a way to identify a customer at the till (app QR now; NFC card and wallet pass later). All resolve to the same customer ID.
- **Ledger:** the append-only list of points changes. Balances are derived from it.
- **Award:** an `earn` ledger entry created when a cashier confirms a purchase.
- **Pending customer:** a customer registered by a cashier by email who has not yet created an account.
- **Fraud clawback:** an admin-only ledger entry that may take a balance below zero.
- **Paused / Suspended:** store states after failed payments (see section 6).
