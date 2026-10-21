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
| Repo | pnpm monorepo: `apps/api`, `apps/web`, `apps/customer`, `packages/shared` |
| Customer app | Expo (React Native) with web export |
| Store dashboard, Cashier screen, admin | One React + Vite web app, installable as a PWA |
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
cp .env.example .env      # then put your real DATABASE_URL in it
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

## Layout

```
apps/
  api/            Fastify API, Drizzle schema and migrations, ledger write path
  web/            Store dashboard, Cashier screen, admin (not built yet)
  customer/       Expo customer app (not built yet)
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
