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
pnpm dev                      # API on http://127.0.0.1:3000 and the Cashier screen on http://localhost:5173
ALLOW_DEV_AUTH=true pnpm dev  # with the development session resolver (local API testing)
pnpm build                    # build packages/shared, apps/api, apps/web and apps/customer
pnpm --filter @bokpoints/customer dev:web   # customer app on http://localhost:8081 (separate terminal)
```

`pnpm dev` runs every workspace's dev script in parallel: the API (hot reload)
and Vite. The customer app is excluded because Expo's dev server is interactive;
start it with the command above. The screen calls the API through Vite's `/v1` proxy, so the browser sees
one origin and no CORS setup is needed. `apps/api/.env` supplies the API's
settings; `apps/web/.env` supplies the Supabase URL and publishable key (copy
`apps/web/.env.example` and fill it in, or the screen cannot sign in).

### The Cashier screen

Open **http://localhost:5173**, sign in with a staff member's email and password,
then type the 6-digit code from an authenticator app. On a first sign-in the
screen shows the key to add to the authenticator, then asks for the first code.

Demo accounts on the live Supabase project (created during the live run):

| Account             | Password          | Who                                   |
| ------------------- | ----------------- | ------------------------------------- |
| `cashier@bk.test`   | `BokpointsDemo3!` | Cashier at Kahvila Bea, Kamppi only   |
| `owner@bk.test`     | `BokpointsDemo2!` | Owner of Kahvila Bea, both branches   |
| `admin@bk.test`     | `BokpointsDemo1!` | Admin, no store membership            |

The authenticator secrets for those three accounts are in `secrets.json` in this
session's temporary `bk-live/` folder
(`/private/var/folders/rz/jn4g4j7s4qn_50dc5vb5glj80000gn/T/opencode/bk-live/`),
which is not part of the repo and may not survive a reboot. If a secret is lost,
delete that account's factor in the Supabase dashboard (Authentication > Users)
and sign in again — the screen offers the setup step. New accounts are made the
same way: create the Supabase user, then `pnpm bootstrap:admin` (for an admin) or
`POST /v1/stores/:storeId/staff` (for store staff).

### The customer app

The Expo app runs in its own terminal, on **http://localhost:8081**:

```bash
pnpm --filter @bokpoints/customer dev:web
```

It needs `apps/customer/.env` (copy `.env.example`) with the same Supabase URL and
publishable key the till uses. Two local settings matter:

- `apps/api/.env` must list the app's origin in `CORS_ORIGINS`, for example
  `CORS_ORIGINS=http://localhost:8081`; restart the API after changing it.
- On a physical phone, `127.0.0.1` is the phone itself. Set
  `EXPO_PUBLIC_API_BASE=http://<your Mac's LAN IP>:3000` and start Expo with
  `--lan`.

Sign-in is an email one-time code. **Once**, in the Supabase dashboard, open
Authentication > Email Templates > Magic Link and make sure the body contains the
code, for example:

```html
<h2>Your BOKPOINTS code</h2>
<p>{{ .Token }}</p>
```

Without `{{ .Token }}` the email only carries a link, and the app's six-digit field
has nothing to accept. The built-in sender is rate-limited on the free plan; wait a
minute between attempts.

The first sign-in provisions the customer and their QR. The till scans the same
opaque identifier it always has, so a new customer can be awarded points straight
away. A production database must apply migration 0007 before this works.

The scanner is a keyboard-wedge device: it types the code and presses Enter into
the focused field. Without hardware, type `CUST-QR-0001` at Kahvila Bea and press
Enter; the customer is Aino, with 15 points.

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
| `GET` | `/v1/me` | Who the caller is, their stores and each store's branches |
| `GET` | `/v1/customer/me` | Customer: own profile and QR credential; provisions on the first call |
| `PATCH` | `/v1/customer/me` | Customer: first name and language |
| `GET` | `/v1/customer/me/stores` | Customer: stores with balances and last activity |
| `GET` | `/v1/customer/me/stores/{storeId}/history` | Customer: last 100 entries with the balance after each |
| `GET` | `/v1/customer/me/expiring` | Customer: points expiring within 14 days (`?days=` for another window) |
| `POST` | `/v1/stores/{storeId}/identify` | Scanned credential to customer, first name and balance |
| `POST` | `/v1/stores/{storeId}/awards/preview` | What a purchase would earn and when it expires; writes nothing |
| `POST` | `/v1/stores/{storeId}/awards` | Award points (requires an `Idempotency-Key` header) |
| `GET` | `/v1/stores/{storeId}/customers/{customerId}/balance` | Balance at that store |
| `POST` | `/v1/admin/stores` | Admin: create the store with its points rule, branches and first owner |
| `POST` | `/v1/stores/{storeId}/staff` | Owner/manager: invite staff, optionally limited to one branch |
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
pnpm --filter @bokpoints/web build       # production build of the Cashier screen
pnpm --filter @bokpoints/customer typecheck
pnpm --filter @bokpoints/customer exec expo export --platform web   # customer web build
```

The integration suite rebuilds `bokpoints_test` from the migration files on every run.
It never touches `bokpoints_dev`.

All of these must pass before a change is done.

## Database

```bash
pnpm db:migrate     # apply pending migrations
pnpm db:generate    # generate a migration after changing apps/api/src/db/schema.ts
pnpm expiry:run     # run the points expiry job once (safe any time, D-108)
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
`HOST` and `LOG_LEVEL` supplied by the host's secret store. The screen builds to
`apps/web/dist`; set `VITE_API_BASE` to the API origin at build time (without it the
screen calls the same origin, which is what the dev proxy provides), and add that
origin to the API's CORS allow-list when the API gets one with the deploy.

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
| The screen on :5173 cannot sign in | `apps/web/.env` is missing or has empty `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. Copy `.env.example` and fill both; restart `pnpm dev`. |
| The code email never arrives, or has no 6-digit code | Supabase's built-in sender is rate-limited (wait a minute). The Magic Link template must contain `{{ .Token }}`; a link-only email gives the app nothing to type. |
| The customer app says the API is not answering | `EXPO_PUBLIC_API_BASE` must reach the API. On a phone that is the Mac's LAN address, not `127.0.0.1`. |
| The customer web app is blocked by CORS | Add `http://localhost:8081` to `CORS_ORIGINS` in `apps/api/.env` and restart the API. |
| The screen says the API is not answering | The API is not running on `127.0.0.1:3000`. `pnpm dev` starts both; check the API's own log first. |
