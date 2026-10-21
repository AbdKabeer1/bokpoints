# DECISIONS: BOKPOINTS

The decision log. One row per decision. Add new decisions at the bottom, give each the next ID, and never delete a row: if a decision changes, mark the old one as Superseded and add a new row that points to it.

Status values:

- **Decided:** the product owner (A) chose it.
- **Decided, confirm:** A chose it, and the reading below needs A's confirmation.
- **Proposed:** a suggestion that is not yet confirmed. Treat it as a default, not a rule.
- **Superseded:** replaced by a later decision.

Dates are given as the month of the decision (Oct 2026) for the planning session.

## Product and business

| ID | Decision | Why | Status | Source |
| --- | --- | --- | --- | --- |
| D-001 | B2B2C. Stores pay a monthly subscription; customers use the product free | Stores are the paying customer; customers are the distribution channel that keeps stores subscribed | Decided | PRD 3, 5 |
| D-002 | Launch market is Finland / EU | First market chosen by A | Decided | PRD 12 |
| D-003 | Points are per store, in one customer wallet. No universal currency for now | Avoids settlement between stores and regulatory questions; keeps the MVP simple | Decided | PRD 10, FRD 3 |
| D-004 | MVP, v1.1 and v2 scope as listed in the PRD | Keeps a solo build achievable | Decided | PRD 8 |
| D-005 | Pilot with 3 to 5 stores in one local area | Cold start needs density | Proposed | PRD 7, 13 |
| D-006 | Pilot-store needs: scope frozen; requests go to a backlog reviewed after the pilot | A asked Claude to decide what is best | Decided | FRD 11 |
| D-007 | A is product manager and product owner until said otherwise; one person builds, designs, tests and supports | Solo project | Decided | PRD 14 |

## Points rules

| ID | Decision | Why | Status | Source |
| --- | --- | --- | --- | --- |
| D-010 | Cashier scans the customer, not the other way around | Prevents customers awarding themselves points | Decided | PRD 10, FRD 4.3 |
| D-011 | Points are calculated from the purchase amount entered by the store. Default rounding is round down. Example: 1 point per euro, 23.80 euros gives 23 points | Simple, predictable, no POS needed at first | Decided | FRD 5.5 |
| D-012 | Points expire 3 months after they are earned; oldest points are used first. Expiry is in the MVP | A's answer ("expires every 3 months"). Reading: each batch expires 3 months after it was earned | Decided (confirmed) | FRD 5.5, 11 |
| D-013 | No reversals. Balances never go below zero, except an admin-only fraud clawback | A's answer | Decided | FRD 4.6, 5.5 |
| D-014 | Owners and managers can still make manual adjustments with a reason, never below zero | Keeps a way to fix mistakes without a reversal feature | Decided (confirmed) | FRD 4.5 |
| D-015 | The cashier sees the amount and the points before confirming. There is no undo afterwards | Compensates for having no reversal | Proposed | FRD 4.3 |
| D-016 | Cashiers can register a customer without the app, by email. Pending records not claimed are deleted after 1 year | A's answer ("kept for 1 year") | Decided | FRD 4.4 |
| D-017 | Later earnings first offset a negative balance after a fraud clawback | Fair and simple | Proposed | FRD 4.6 |

## Credentials, offline and integrations

| ID | Decision | Why | Status | Source |
| --- | --- | --- | --- | --- |
| D-020 | Credential model: QR in the app now; physical NFC card in v1.1; Apple and Google Wallet passes in v2. All resolve to the same customer ID | Lets new identification methods be added without rewriting the core | Decided | FRD 3, 5.6 |
| D-021 | Awarding works online and offline in the MVP | A's answer | Decided | FRD 4.8 |
| D-022 | Offline QR design: platform-signed credential (about 7 days) plus a one-time phone proof (about 1 minute), checked on the cashier device; the server re-validates at sync | Makes offline checks possible without distributing customer lists | Proposed (to be finalized in the architecture work) | FRD 5.6 |
| D-023 | Offline limits (cap per offline award, queue size) are configuration values to be set later | Avoid hardcoding guesses | Proposed | FRD 5.10 |
| D-024 | POS integration must be possible. API-first design; manual amount entry in the MVP; first integrations in v2 | A's answer | Decided | PRD 11, FRD 5.9 |
| D-025 | Apple Wallet tap depends on Apple's approval and compatible terminals, so it is a later phase | Third-party dependency | Decided | PRD 11 |

## Customers, apps and messages

| ID | Decision | Why | Status | Source |
| --- | --- | --- | --- | --- |
| D-030 | Customer app on the Apple App Store, Google Play and web | A's answer | Decided | FRD 5.2 |
| D-031 | Customer sign-up and sign-in verified by email. Phone number optional and unverified in the MVP | SMS has a cost and is deferred | Decided | FRD 5.1 |
| D-032 | No SMS in the MVP. Notices are in-app; push comes in v1.1. SMS later, with a cost plan | A's answer; SMS fees are normally billed to the sender | Decided | FRD 5.8 |
| D-033 | Finnish and English at launch | Finnish market | Proposed | FRD 5.12 |
| D-034 | Expiry reminder shown 14 days before expiry | Gives customers time to act | Proposed | FRD 5.2 |

## Billing

| ID | Decision | Why | Status | Source |
| --- | --- | --- | --- | --- |
| D-040 | Monthly subscription per store. Pricing, tiers and trial are not decided | A's answer on the model | Decided (pricing open) | PRD 5 |
| D-041 | Failed payments: reminder at day 7, store Paused at day 14, Suspended at day 30. Customers always keep access to their balances | A's answer | Decided | FRD 5.7 |
| D-042 | Paused means no changes to campaigns, rewards, products or rules while awarding continues. Suspended blocks awarding | Reading of "pause" that protects customers | Decided (confirmed) | FRD 5.7, 11 |

## Technology

| ID | Decision | Why | Status | Source |
| --- | --- | --- | --- | --- |
| D-050 | One TypeScript monorepo (pnpm): `api`, `web`, `customer`, `shared` | Shared code between server and offline till; best for one developer | Decided | AGENT.md 3, 4 |
| D-051 | Customer app: Expo (React Native) with web export | One codebase for iOS, Android and web | Decided | AGENT.md 3 |
| D-052 | Store dashboard, Cashier screen and admin: one React + Vite web app, installable as a PWA | Offline queue through service worker and IndexedDB; no server rendering needed behind login | Decided | AGENT.md 3 |
| D-053 | API: Node + Fastify, Zod validation, OpenAPI, versioned | Standalone, documented API that POS integrations can use later | Decided | AGENT.md 3 |
| D-054 | Database: PostgreSQL in an EU region with Drizzle ORM | Ledger needs real transactions and constraints | Decided | AGENT.md 3 |
| D-055 | Auth: Supabase Auth (email codes for customers; password plus MFA for staff and admins). Only the API writes points; apps never query the database directly | Security and EU hosting | Decided | AGENT.md 3, 8 |
| D-056 | QR signing with Ed25519 using a vetted library; no custom crypto | Security | Decided | AGENT.md 3, 8 |
| D-057 | Billing with Stripe Billing and Stripe Tax | Monthly subscriptions and Finnish VAT invoices | Decided | AGENT.md 3 |
| D-058 | Testing with Vitest and Playwright; Sentry for errors; GitHub Actions for CI | Standard for this stack | Decided | AGENT.md 3 |
| D-059 | Hosting and email providers are not chosen yet | Decide before the first deployment | Open | AGENT.md 16 |
| D-063 | TypeScript 6.0.3, not 7.0.2 | typescript-eslint 8.72.0 requires `typescript >=4.8.4 <6.1.0`, so TypeScript 7 is not yet supported by the linter | Decided | AGENT.md 3 |
| D-064 | Vitest 4.1.12, not 5.x | Vitest 5 requires Node `^22.12 \|\| ^24 \|\| >=26` and excludes the installed Node 25; Vitest 4 accepts `>=24` | Decided | AGENT.md 3 |
| D-065 | `pointsPerEuro` is stored in thousandths as an integer | Keeps every points calculation in integer maths, so the server and the offline till cannot disagree on a balance | Decided | FR-PTS-1 |
| D-066 | Expiry clamps to the last day of a short target month | "3 months after the day they were earned" has no exact answer for 31 January; clamping to 30 April is the reading that never expires points early | Decided | FR-PTS-10, AC-6 |
| D-067 | The ledger and the audit log are protected by database triggers, not only by application code | The append-only rule is a product invariant, so the database must refuse the write even if the application code is wrong | Decided | FR-AUD-2 |
| D-068 | A non-negative balance is enforced by a direction CHECK on ledger entries plus a guarded balance update, not by a CHECK on the balance row | A fraud clawback is allowed to go below zero, which a `balance >= 0` constraint cannot express | Decided | FR-PTS-8, AC-11 |
| D-069 | Local PostgreSQL 17 via Homebrew is the development and integration-test database | AGENT.md requires integration tests against a real Postgres; PGlite is not a real server | Decided | AGENT.md 5, 12 |
| D-070 | The repository is private at github.com/AbdKabeer1/bokpoints | Unreleased product with unreviewed legal and privacy text | Decided | This session |
| D-071 | Adjustments and fraud clawbacks take a signed delta, positive adds and negative removes | One sign convention across the module, matching the signed `points` column on a ledger entry, removes the usual source of sign bugs | Decided | FR-PTS-8, AC-11 |
| D-072 | An award below the minimum purchase returns zero points with a reason, it is not an error | FR-PTS-2 says award zero points and tell the cashier why, so a minimum-purchase miss is a normal outcome | Decided | FR-PTS-2 |
| D-073 | The idempotency key is unique per store, not globally | A global key would let a cashier at Store B have an award silently deduped against Store A's entry, which leaks across stores | Decided | FR-PTS-4 |
| D-074 | Balance changes are a single guarded SQL statement | Reading the balance and writing an absolute value loses a delta when two cashiers adjust at the same instant; Postgres re-evaluates the guard after the row lock | Decided | FR-PTS-5, FR-PTS-8 |

## Process and documents

| ID | Decision | Why | Status | Source |
| --- | --- | --- | --- | --- |
| D-060 | Document set: PRD, FRD, AGENT.md, HANDOFF.md, DECISIONS.md | A's request | Decided | HANDOFF 1 |
| D-061 | The FRD wins over code. An agent that finds a conflict stops and asks | Keeps rules consistent | Decided | AGENT.md 2 |
| D-062 | At the end of every session, update HANDOFF.md and DECISIONS.md | One person holds all the context | Decided | AGENT.md 14 |

## Open decisions (not yet made)

Move an item into a table above when it is decided.

- Subscription pricing, tiers, trial, setup fee, NFC card charges.
- Points earn-rate defaults; redemption options for v1.1.
- Final offline QR design and limits.
- Fraud clawback process.
- Hosting and email providers.
- Privacy basis for keeping pending-customer emails for 1 year.
- Pilot area and first stores; POS systems they use.
- Brand, name checks and domain.
- Legal and tax review of terms and privacy policy.

## Template for a new decision
```
| D-0XX | What was decided | Why | Decided / Decided, confirm / Proposed | Where it is described |
```
