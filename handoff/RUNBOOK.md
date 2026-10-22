# RUNBOOK

Every command below is run from the repository root, `/Users/mrroddy/bokpoints`.

## Prerequisites

```bash
brew install postgresql@17     # once
brew services start postgresql@17
createdb bokpoints_dev
createdb bokpoints_test
```

Check Postgres is up:

```bash
pg_isready -h localhost -U postgres
```

## Setup

```bash
pnpm install
cp .env.example apps/api/.env
```

`apps/api/.env` is gitignored. Never commit real values; the API reads them from the process
environment.

## Run

```bash
pnpm dev                      # API with hot reload on http://127.0.0.1:3000
ALLOW_DEV_AUTH=true pnpm dev  # same, with the development session resolver
pnpm build                    # build packages/shared and apps/api
```

`pnpm dev` reads `apps/api/.env` if there is one.

`ALLOW_DEV_AUTH` is off by default and the server refuses to start with it on in
production. With it on, the bearer token is a staff member's email address. The
role is always read from the database, never from the token.

### Real sign-in with Supabase

```bash
# apps/api/.env needs DATABASE_URL, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.
# 1. In the Supabase dashboard, Authentication > Users, create a user
#    (email and password, confirmed) and copy their User UID.
pnpm bootstrap:admin --email you@example.com --name "Your Name" --auth-user-id <User UID>

# 2. Sign in with the password and an authenticator-app code. The first time it
#    enrols the authenticator and prints the secret. It prints a short-lived token.
pnpm staff:login --email you@example.com

# 3. Use the token.
curl -H "Authorization: Bearer <token>" http://127.0.0.1:3000/v1/...
```

Do not set `ALLOW_DEV_AUTH` together with `SUPABASE_URL`: the server refuses to start.
The secret key and the database password stay in `apps/api/.env` only.

### Migrate the hosted database

The hosted Supabase Postgres keeps its URL in `apps/api/.env` as `SUPABASE_DB_URL`
(separate from the active local `DATABASE_URL`, which always points at local dev).
To apply pending migrations there, from `apps/api`:

```bash
DATABASE_URL="$(sed -n 's/^SUPABASE_DB_URL=//p' .env)" pnpm db:migrate
```

Health check:

```bash
curl http://127.0.0.1:3000/v1/health
# {"status":"ok","version":"0.1.0"}
```

## The API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/stores/{storeId}/identify` | Scanned credential to customer, first name and balance |
| `POST` | `/v1/stores/{storeId}/awards` | Award points (requires an `Idempotency-Key` header) |
| `GET` | `/v1/stores/{storeId}/customers/{customerId}/balance` | Balance at that store |
| `GET` | `/v1/docs` | Swagger UI |
| `GET` | `/v1/openapi.json` | The OpenAPI document |

`201` means a new award was created. `200` means the request was a replay of an
existing award, or awarded nothing (for example under the store minimum).

## Verify

```bash
pnpm typecheck
pnpm lint
pnpm test                                # unit
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bokpoints_test pnpm test:integration
```

The integration suite rebuilds `bokpoints_test` from the migration files on every run.
It never touches `bokpoints_dev`.

All four must pass before a change is done.

## Database

```bash
pnpm db:migrate     # apply pending migrations
pnpm db:generate    # generate a migration after changing apps/api/src/db/schema.ts
```

Rules:

- Never edit a migration that has been applied. Change the schema and generate a new one.
- Never run destructive operations on `points_ledger_entries` or `audit_log_entries`.
  The database refuses it anyway: both tables are append-only by trigger.
- `drizzle/meta/` is committed. Do not delete it, or the next `db:generate` will want
  to recreate the schema from scratch.
- **Drizzle does not track triggers.** The append-only triggers on
  `points_ledger_entries` and `audit_log_entries` live only in the SQL migration files,
  never in `schema.ts`. After every `db:generate`, check the generated SQL and the
  existing migration files to confirm the triggers are still there, and check
  `drizzle/meta/` did not drop them. The same applies to the hand-written
  `prevent_mutation()` function.

To reset the local development database:

```bash
psql "postgres://postgres:postgres@localhost:5432/bokpoints_dev" \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
pnpm db:migrate
```

## Deploy

Not set up. The API needs an EU container host and the web app a static host, and
neither provider has been chosen yet (`docs/DECISIONS.md` D-059). The API builds to
`apps/api/dist` and starts with `node dist/server.js`, with `DATABASE_URL`, `PORT`,
`HOST` and `LOG_LEVEL` supplied by the host's secret store.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:
typecheck, lint, unit tests, then integration tests against a `postgres:17` service
container.

Check the run:

```bash
gh run list --limit 5
gh run watch
```

## Common problems

| Symptom | Cause and fix |
| --- | --- |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm 12 blocks dependency build scripts. `allowBuilds` is set in `pnpm-workspace.yaml`; if a new dependency needs one, add it there. |
| `No test files found` | The Vitest config's include patterns are root-relative. Run tests from the repo root: `pnpm exec vitest run --project unit <path>`. |
| `Cannot find module '@bokpoints/shared'` | The shared package has not been built. Run `pnpm --filter @bokpoints/shared build`, or use `pnpm typecheck`, which builds it first. |
| Integration tests fail to connect | Postgres is not running, or `DATABASE_URL` points at the wrong database. The tests expect `bokpoints_test`. |
| `role "postgres" does not exist` | Homebrew's Postgres only creates the OS user. Create the role once: `psql -d postgres -c "CREATE ROLE postgres WITH SUPERUSER LOGIN PASSWORD 'postgres';"` |
