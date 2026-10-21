# DECISIONS

The canonical decision log is [`docs/DECISIONS.md`](../docs/DECISIONS.md). It has one row
per decision, with the reason and the status, and rows are never deleted: a changed
decision is marked `Superseded` and a new row points at it.

This file is a short pointer, not a copy, so there is only ever one place to look.

## Where the decisions live

| Section | What it covers |
| --- | --- |
| Product and business | B2B2C model, market, scope by phase, pilot shape |
| Points rules | Per-store points, expiry, reversals, manual adjustment, fraud clawback |
| Credentials, offline and integrations | QR now, NFC card in v1.1, wallet passes in v2, POS |
| Customers, apps and messages | App formats, sign-in, SMS, languages, expiry reminders |
| Billing | Subscription model and the failed-payment schedule |
| Technology | The locked stack and the choices made while building it |
| Process and documents | The document set and the rules about updating them |

## Decisions made in the first build session

These are also in `docs/DECISIONS.md` as D-063 to D-074.

| ID | Decision | Status |
| --- | --- | --- |
| D-063 | TypeScript 6.0.3, not 7.0.2, because typescript-eslint requires `typescript <6.1.0` | Decided |
| D-064 | Vitest 4.1.12, not 5.x, because Vitest 5 excludes Node 25 | Decided |
| D-065 | `pointsPerEuro` is an integer in thousandths | Decided |
| D-066 | Expiry clamps to the last day of a short target month | Decided |
| D-067 | The ledger and audit log are append-only by database trigger | Decided |
| D-068 | A non-negative balance is enforced by a direction CHECK plus a guarded balance update | Decided |
| D-069 | Local PostgreSQL 17 via Homebrew is the development and integration-test database | Decided |
| D-070 | The repository is private at `github.com/AbdKabeer1/bokpoints` | Decided |
| D-071 | Adjustments and clawbacks take a signed delta | Decided |
| D-072 | An award below the minimum purchase returns zero points with a reason | Decided |
| D-073 | The idempotency key is unique per store, not globally | Decided |
| D-074 | Balance changes are a single guarded SQL statement | Decided |

## Still open

The list of undecided items is at the bottom of `docs/DECISIONS.md`. The ones that block
the next build steps are the hosting and email providers (D-059) and the final offline QR
design (D-022).
