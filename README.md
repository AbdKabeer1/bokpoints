# BOKPOINTS

A B2B2C loyalty platform for small businesses (SMEs) in Finland / EU. A cashier scans a
customer's QR code, enters the purchase amount, and the customer earns points **at that
store**. Stores pay a monthly subscription; customers use the product free.

Three surfaces: a customer app (iOS, Android, web), a store dashboard with a Cashier
screen, and an admin panel. Points expire 3 months after the day they were earned.

## Status

Build order step 1 and 2 of `AGENT.md` section 13 are done. The monorepo, the points
engine, the ledger schema and the transactional ledger write path exist and are tested.
The customer app, the Cashier screen, auth, billing and offline awarding are not built yet.

See `docs/HANDOFF.md` for the current state and what is next, and `docs/DECISIONS.md`
for why each decision was made.

## Stack

TypeScript everywhere, one pnpm monorepo. The locked stack and the reasons for it are in
`AGENT.md` section 3.

| Layer | Choice |
| --- | --- |
| Repo | pnpm monorepo: `apps/api`, `apps/web`, `apps/owner`, `apps/admin`, `apps/customer`, `packages/shared` |
| Customer app | Expo (React Native) with web export |
| Staff web apps | React + Vite: cashier till (`apps/web`), merchant dashboard (`apps/owner`), platform console (`apps/admin`) |
| API | Node + Fastify, Zod validation, versioned (`/v1`) |
| Database | PostgreSQL 17, Drizzle ORM and Drizzle migrations |
| Auth | Supabase Auth (email one-time codes for customers, password plus MFA for staff) |
| QR security | Ed25519 signatures using `@noble/curves` |
| Billing | Stripe Billing and Stripe Tax |
| Testing | Vitest (unit and integration), Playwright (end to end, not set up yet) |

## Prerequisites

- Node 24 or newer (the repo is tested on Node 25)
- pnpm 12
- PostgreSQL 17 running locally

```bash
brew install postgresql@17
brew services start postgresql@17
createdb bokpoints_dev
createdb bokpoints_test
```

## Setup

```bash
pnpm install
cp .env.example apps/api/.env   # then put your real values in it
```

## Commands

```bash
pnpm dev                # run the API with hot reload
pnpm build              # build the shared package and the API
pnpm typecheck          # TypeScript checks across the repo
pnpm lint               # lint
pnpm test               # unit tests (Vitest)
pnpm test:integration   # tests against a real local Postgres
pnpm db:migrate         # apply database migrations
pnpm db:generate        # generate a migration from schema changes
```

The integration tests rebuild `bokpoints_test` from the real migration files on every
run, so they always test the schema a deployment would have.

## API

Versioned under `/v1` and documented at `/v1/docs` (Swagger UI) and `/v1/openapi.json`.
The OpenAPI document is generated from the same Zod schemas that validate the
requests, so it cannot drift away from the code.

| Method | Path | What it does | FRD |
| --- | --- | --- | --- |
| `POST` | `/v1/stores/{storeId}/identify` | Resolve a scanned credential to a customer, first name and balance at that store | FR-STO-9, FR-API-1 |
| `POST` | `/v1/stores/{storeId}/awards` | Award points for a purchase | FR-PTS-4, FR-API-1 |
| `GET` | `/v1/stores/{storeId}/customers/{customerId}/balance` | The balance at that store | FR-API-1, AC-3 |
| `GET` | `/v1/health`, `/v1/ping` | Liveness | — |

Every call is authenticated, scoped to one store and permission-checked on the
server (FR-API-2). A caller who is not a member of the store in the URL gets
`403 STORE_MISMATCH`, before any capability is considered.

### Calling it

```bash
pnpm dev                                        # start the API
curl http://127.0.0.1:3000/v1/health

curl -X POST http://127.0.0.1:3000/v1/stores/$STORE/identify \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"credentialIdentifier":"cred_demo_123","credentialType":"app_qr"}'

curl -X POST http://127.0.0.1:3000/v1/stores/$STORE/awards \
  -H "authorization: Bearer $TOKEN" \
  -H "idempotency-key: any-unique-string" \
  -H "content-type: application/json" \
  -d '{"customerId":"'$CUSTOMER'","amountCents":2380}'
```

`Idempotency-Key` is required. A retry with the same key returns the original
award and never awards twice. The same key with a **different** amount is refused
with `409`, because that is a mistake rather than a retry.

The endpoint refuses what it should: a suspended or offboarded store (`403`), a
deactivated staff account (`403`), a deleted customer (`404`), a lost or revoked
credential (`404`), and an amount beyond €1,000,000 (`400`). A paused store still
awards, because awarding continues while a store is paused.

### Authentication

The token is verified by a `SessionResolver` (`apps/api/src/auth/session.ts`).
With `SUPABASE_URL` set, the API verifies Supabase access tokens against the
project's public keys, and staff and admin tokens must have passed a second
factor (`403 MFA_REQUIRED` otherwise). Production refuses to start without it.
`pnpm bootstrap:admin` creates the first admin and `pnpm staff:login` gets a real
token. Without Supabase there is a development resolver where the bearer token
is a staff member's **email address**:

```bash
ALLOW_DEV_AUTH=true pnpm dev
```

It is off by default and refuses to start in production. The token never
carries a role: the role is always read from the staff member's store
membership, so a caller cannot promote themselves by sending a different
token.

## Layout

```
apps/
  api/            Fastify API, Drizzle schema and migrations, ledger write path
  web/            OmaPointii Store Portal — cashier till (:5173)
  owner/          OmaPointii Merchant Platform — store owner/manager dashboard (:5174)
  admin/          OmaPointii Platform Admin — platform control room (:5175)
  customer/       Expo customer app, native + web (:8081)
packages/
  shared/         Points engine, expiry, FIFO, balance rules, permissions
  config/         Shared tsconfig, eslint and prettier config
docs/
  PRD.md          Product requirements (exported from the source PDF)
  FRD.md          Functional requirements (exported from the source PDF)
  HANDOFF.md      Current state, what is next, session log
  DECISIONS.md    Decision log
  source/         The source PDFs the PRD and FRD were exported from
```

Business logic lives in `packages/shared` as pure functions, so the API and the future
offline Cashier screen use the same code for points calculation and cannot disagree
about a balance.
