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
cp .env.example .env
```

`.env` is gitignored. Never commit real values; the API reads them from the process
environment.

## Run

```bash
pnpm dev        # API with hot reload on http://127.0.0.1:3000
pnpm build      # build packages/shared and apps/api
```

Health check:

```bash
curl http://127.0.0.1:3000/v1/health
# {"status":"ok","version":"0.1.0"}
```

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
