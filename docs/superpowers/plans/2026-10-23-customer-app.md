# Customer App v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer signs in with an email one-time code, gets a QR the till already scans, and sees per-store balances, history and points expiring within 14 days.

**Architecture:** One new column (`customers.auth_user_id`) plus a customer-scoped API surface whose identity always comes from the bearer token. The app is an Expo React Native codebase with a web export; the API work is independent of it, so it lands first and is tested without any device.

**Tech Stack:** TypeScript (strict), Fastify 5 + Zod + Drizzle, PostgreSQL 17, Expo SDK (React Native + react-native-web), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-customer-app-design.md`

## Global Constraints

- Strict TypeScript, no `any`, `exactOptionalPropertyTypes` is on.
- No new API dependency except `@fastify/cors` (small, maintained, needed for the Expo web origin).
- No new app dependency beyond: `expo`, `react-native-web`, `@react-native-async-storage/async-storage`, `react-native-qrcode-svg`, `react-native-svg`.
- Customer identity comes only from the token; no endpoint takes a customer id.
- Staff auth still requires `aal2`; customer tokens are `aal1` and must not reach staff routes.
- Migration 0007 is applied locally only; the hosted database waits for the owner's word.
- UI language is English for v1; `language` is stored (`fi`/`en`).
- Tests run from the repo root: `pnpm exec vitest run --project unit <path>` and `--project integration <path>`.
- Every task ends with typecheck, lint and its tests green, then one commit.

## Review Focus

- **A token with no customer row must provision exactly one customer and one credential**, even on simultaneous first requests. Pinned in Task 3.
- **A row already linked to a different Supabase user must never be taken over** by someone who signs in with the same email. Pinned in Task 3.
- **One customer must never read another's balances or history** by changing an id. Pinned in Tasks 3 and 4.
- **`balanceAfter` must equal the balance after each entry** across mixed signed entries, including when the last 100 are returned. Pinned in Task 4.
- **The expiring window boundary** (exactly 14 days, already expired, zero remaining) decides what a customer is warned about. Pinned in Task 4.
- **A signed-out session must never leave stale data on screen**, and a token without a verified email claim must never provision a customer. Pinned in Tasks 2 and 7.

---

### Task 1: `customers.auth_user_id` (migration 0007)

**Files:**
- Modify: `apps/api/src/db/schema.ts` (customers table)
- Create (generated): `apps/api/drizzle/0007_*.sql`, updated `apps/api/drizzle/meta/*`

**Interfaces:**
- Produces: `customers.authUserId: uuid | null`, unique index `customers_auth_user_unique`.

- [ ] **Step 1: Add the column to the Drizzle schema**

In the `customers` table definition, add `authUserId: uuid('auth_user_id')` after `email`, and `uniqueIndex('customers_auth_user_unique').on(t.authUserId)` to the table's extra config.

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @bokpoints/api db:generate`
Expected: a new `apps/api/drizzle/0007_*.sql` containing `ALTER TABLE "customers" ADD COLUMN "auth_user_id" uuid;` and a unique index; journal and snapshot updated.

- [ ] **Step 3: Check the SQL by hand**

Open the generated file. Confirm it only adds the column and the index, and that no append-only trigger or policy is dropped.

- [ ] **Step 4: Apply locally**

Run: `pnpm db:migrate`
Expected: `0007` applied without error.

- [ ] **Step 5: Run the migration guard test**

Run: `pnpm exec vitest run --project unit apps/api/test/unit/migrations.test.ts`
Expected: PASS (journal and files in step).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle
git commit -m "Add customers.auth_user_id for customer sign-in"
```

---

### Task 2: Customer token verification

**Files:**
- Modify: `apps/api/src/auth/session.ts` (`CustomerPrincipal`, `CustomerSessionResolver`)
- Modify: `apps/api/src/auth/supabase-session.ts` (`createSupabaseCustomerResolver`)
- Modify: `apps/api/src/auth/dev-session.ts` (`createDevCustomerResolver`, `uuidFromEmail`)
- Test: `apps/api/test/unit/supabase-session.test.ts`

**Interfaces:**
- Produces:
  - `interface CustomerPrincipal { authUserId: string; email: string }`
  - `interface CustomerSessionResolver { resolve(token: string): Promise<CustomerPrincipal | null> }`
  - `createSupabaseCustomerResolver(options: SupabaseResolverOptions): CustomerSessionResolver` — same key set, same `ES256`/`RS256` allow-list, **no** `aal2` check; requires a non-empty `email` claim and a UUID `sub`.
  - `createDevCustomerResolver(): CustomerSessionResolver` — token is the email; `authUserId = uuidFromEmail(email)`.
  - `uuidFromEmail(email: string): string` — lowercase, SHA-1 of the email formatted as a UUID (version 5 layout), deterministic.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/unit/supabase-session.test.ts`, add:

```ts
it('accepts an aal1 customer token and returns its verified email', async () => {
  // sign with the test key, claims: sub = random uuid, email = 'a@b.test', aal = 'aal1'
  const resolver = createSupabaseCustomerResolver({ db, supabaseUrl: 'https://test.supabase.co', keys });
  expect(await resolver.resolve(token)).toEqual({ authUserId: sub, email: 'a@b.test' });
});

it('refuses a customer token with no email claim', async () => { /* claims without email -> null */ });

it('still requires aal2 for staff tokens', async () => {
  // same signing setup as the existing staff test, aal = 'aal1' -> rejects with MfaRequiredError
});
```

Also add a dev-resolver test: `uuidFromEmail('A@B.test') === uuidFromEmail('a@b.test')`, and the result matches a UUID regex.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm exec vitest run --project unit apps/api/test/unit/supabase-session.test.ts`
Expected: FAIL — `createSupabaseCustomerResolver` is not exported.

- [ ] **Step 3: Implement the resolvers**

In `supabase-session.ts`, lift the existing JWKS creation and `jwtVerify` call into one internal function returning `JWTPayload | null`, then:

- staff resolver keeps its current body (staff lookup, then `aal2` check);
- customer resolver validates `sub` and `email` only, without any database read.

In `session.ts`, add the two interfaces. In `dev-session.ts`, add `uuidFromEmail` (node:crypto SHA-1) and the stateless dev customer resolver.

- [ ] **Step 4: Run the tests to see them pass**

Run: the same command.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/test/unit/supabase-session.test.ts
git commit -m "Add customer token verification (aal1, no staff lookup)"
```

---

### Task 3: Provisioning, `GET /v1/customer/me`, `PATCH /v1/customer/me`

**Files:**
- Create: `apps/api/src/db/customers.ts`
- Create: `apps/api/src/routes/customer.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `apps/api/src/app.ts` (`BuildAppOptions.customerResolver`, register routes)
- Modify: `apps/api/src/server.ts` (create the resolver from `SUPABASE_URL` / dev auth)
- Test: `apps/api/test/integration/customer-app.test.ts` (new file)

**Interfaces:**
- Produces:
  - `provisionCustomer(db, principal: CustomerPrincipal): Promise<{ customerId: string; credentialIdentifier: string }>` — one transaction; find by `auth_user_id`, else claim an unlinked row with the same lowercased email, else insert; ensure one active `app_qr` credential (`CUS-` + 26 base32 chars from 16 random bytes).
  - `GET /v1/customer/me` → `{ customer: { id, email, name, language, createdAt }, credential: { type: 'app_qr', identifier }, onboardingComplete: boolean }`
  - `PATCH /v1/customer/me` body `{ name?: string; language?: 'fi' | 'en' }` → the same shape as GET.
  - Error codes: `401 MISSING_TOKEN` / `INVALID_TOKEN`, `403 ACCOUNT_DELETED`, `409 EMAIL_ALREADY_LINKED`.
- Consumes: `CustomerSessionResolver` from Task 2.

- [ ] **Step 1: Write the failing integration tests**

Create `apps/api/test/integration/customer-app.test.ts` using the existing integration setup (`applyMigrations`, `truncateAll`, `buildApp`), and pass `customerResolver: createDevCustomerResolver()`:

```ts
it('provisions exactly one customer and one credential on the first call', async () => {
  const first = await get('/v1/customer/me', 'new@test.dev');
  const second = await get('/v1/customer/me', 'new@test.dev');
  expect(first.statusCode).toBe(200);
  expect(second.json().customer.id).toBe(first.json().customer.id);
  expect(second.json().credential.identifier).toBe(first.json().credential.identifier);
  expect(first.json().credential.identifier).toMatch(/^CUS-[A-Z2-7]{26}$/);
  expect(first.json().onboardingComplete).toBe(false);
  // exactly one customers row and one credentials row
});

it('claims an existing unlinked customer row with the same email', async () => {
  // insert customers (email 'known@test.dev', name 'Aino', auth_user_id NULL)
  const res = await get('/v1/customer/me', 'known@test.dev');
  expect(res.statusCode).toBe(200);
  expect(res.json().customer.id).toBe(existingId);
  // the row now has auth_user_id set
});

it('refuses to take over a row already linked to another auth user', async () => {
  // insert customers with auth_user_id = randomUUID(), email 'taken@test.dev'
  const res = await get('/v1/customer/me', 'taken@test.dev');
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('EMAIL_ALREADY_LINKED');
});

it('saves a name and language, and flips onboardingComplete', async () => {
  const res = await patch('/v1/customer/me', 'new@test.dev', { name: '  Aino  ', language: 'en' });
  expect(res.json().customer.name).toBe('Aino');
  expect(res.json().onboardingComplete).toBe(true);
});

it('rejects an empty name and an unknown language', async () => {
  expect((await patch(..., { name: '   ' })).statusCode).toBe(400);
  expect((await patch(..., { language: 'de' })).statusCode).toBe(400);
});

it('refuses a deleted customer', async () => {
  // customers row with auth_user_id of the dev principal, status 'deleted'
  expect((await get('/v1/customer/me', 'gone@test.dev')).statusCode).toBe(403);
});

it('needs a token', async () => {
  expect((await get('/v1/customer/me', null)).statusCode).toBe(401);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project integration apps/api/test/integration/customer-app.test.ts`
Expected: FAIL — 404 on the routes.

- [ ] **Step 3: Add the shared schemas**

`customerProfileSchema`, `customerCredentialSchema`, `customerMeResponseSchema`, `updateCustomerRequestSchema` (both fields optional, `name` trimmed length 1–100, `language` enum `fi`/`en`, at least one field present).

- [ ] **Step 4: Implement `provisionCustomer`**

One transaction: select by `auth_user_id`; if found and `status = 'deleted'` → `ACCOUNT_DELETED`; else select by `lower(email)` with `auth_user_id IS NULL` and `status = 'active'` and link it; a deleted row with that email also answers `ACCOUNT_DELETED`; else insert. Catch the unique violation on email → `EMAIL_ALREADY_LINKED`. Then select an active `app_qr` credential; if none, insert one (retry the insert once on an identifier collision).

- [ ] **Step 5: Implement the routes and wiring**

`customerRoutes` takes `{ db, customerResolver, rateLimit }`. `GET /v1/customer/me` resolves the token, provisions, returns the profile. `PATCH` applies the trimmed name/language and returns the same shape. Register in `app.ts`; build the customer resolver in `server.ts` from the same options as the staff resolver.

- [ ] **Step 6: Run the tests**

Run: the command from Step 2.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/customers.ts apps/api/src/routes/customer.ts \
  apps/api/src/app.ts apps/api/src/server.ts packages/shared/src/schemas.ts \
  apps/api/test/integration/customer-app.test.ts
git commit -m "Add customer provisioning and profile endpoints"
```

---

### Task 4: Stores, history and expiring points

**Files:**
- Modify: `apps/api/src/db/customers.ts`
- Modify: `apps/api/src/routes/customer.ts`
- Modify: `packages/shared/src/schemas.ts`
- Test: `apps/api/test/integration/customer-app.test.ts` (extend)

**Interfaces:**
- Produces:
  - `GET /v1/customer/me/stores` → `{ stores: [{ storeId, name, balance, lastActivityAt }] }`, stores from the customer's ledger, newest activity first.
  - `GET /v1/customer/me/stores/:storeId/history` → `{ storeName, balance, entries: [{ id, createdAt, type, points, balanceAfter }] }`, last 100, newest first; `404 STORE_NOT_FOUND` when the customer has no entry at that store.
  - `GET /v1/customer/me/expiring?days=14` → `{ windowDays, items: [{ storeId, storeName, points, expiresAt }] }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists only stores with activity, newest first, with the live balance', async () => {
  // earn 25 at store A (batch), earn 10 at store B, expire A entirely
  // expect A with balance 0 and its activity, B with 10; B first when it is newer
});

it('returns history with the true running balance, newest first', async () => {
  // earn 25, adjust -10, earn 5 -> entries: +5 (bal 20), -10 (bal 15), +25 (bal 25)
  // expect exactly that order and those balanceAfter values
});

it('caps history at 100 entries and keeps balanceAfter correct', async () => {
  // insert 105 earn entries of 1 point; expect 100 entries, newest first,
  // and the oldest returned entry's balanceAfter equals 6
});

it('refuses a store the customer has no history at', async () => {
  expect((await get(`/v1/customer/me/stores/${randomUUID()}/history`, 'new@test.dev')).statusCode).toBe(404);
});

it('returns only batches inside the window, excluding zero and expired', async () => {
  // batches: remaining 5 expiring in 10 days, 0 remaining in 5 days, 7 expiring in 20 days
  // expect exactly the first, with its store name and date
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project integration apps/api/test/integration/customer-app.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Implement the three handlers**

Stores: `SELECT` distinct ledger stores joined to stores and points_balances, with `MAX(created_at)`, ordered by that descending. History: window sum in SQL (`SUM(points) OVER (ORDER BY created_at, id)`), then keep the newest 100. Expiring: `points_batches` where `remaining_points > 0 AND expires_at > now() AND expires_at <= now() + interval`.

- [ ] **Step 4: Run the tests**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/customers.ts apps/api/src/routes/customer.ts \
  packages/shared/src/schemas.ts apps/api/test/integration/customer-app.test.ts
git commit -m "Add customer stores, history and expiring endpoints"
```

---

### Task 5: CORS allow-list for the Expo web origin

**Files:**
- Modify: `apps/api/package.json` (`@fastify/cors`)
- Modify: `apps/api/src/app.ts` (`corsOrigins` option)
- Modify: `apps/api/src/server.ts` (env)
- Modify: `apps/api/src/env.ts` (`CORS_ORIGINS`, optional)
- Modify: `apps/api/.env.example`, `apps/api/.env` (local allows `http://localhost:8081`)
- Test: `apps/api/test/integration/customer-app.test.ts` (extend)

**Interfaces:**
- Produces: `BuildAppOptions.corsOrigins?: string[]`; when non-empty, `Access-Control-Allow-Origin` echoes an allowed origin; when empty/absent, no CORS headers.

- [ ] **Step 1: Write the failing test**

```ts
it('allows the configured web origin and no other', async () => {
  const app = await buildApp({ db, sessionResolver, customerResolver, corsOrigins: ['http://localhost:8081'] });
  const allowed = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin: 'http://localhost:8081' } });
  const other = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin: 'http://evil.test' } });
  expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  expect(other.headers['access-control-allow-origin']).toBeUndefined();
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run --project integration -t "configured web origin"`
Expected: FAIL — no header.

- [ ] **Step 3: Install and wire**

`pnpm --filter @bokpoints/api add @fastify/cors`; register with `origin: options.corsOrigins ?? false` before the route plugins; parse `CORS_ORIGINS` (comma-separated, trimmed, empty → `[]`).

- [ ] **Step 4: Run the test**

Expected: PASS. Also run the whole integration project once (nothing else should change).

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/app.ts apps/api/src/server.ts \
  apps/api/src/env.ts apps/api/.env.example apps/api/test/integration/customer-app.test.ts
git commit -m "Add a CORS allow-list for the customer web build"
```

---

### Task 6: Expo scaffold, pure helpers, web-export gate

**Files:**
- Modify: `apps/customer/package.json` (real app)
- Create: `apps/customer/app.json`, `babel.config.js`, `metro.config.js`, `tsconfig.json`, `index.ts`, `App.tsx`, `.env.example`
- Create: `apps/customer/src/lib/format.ts`
- Test: `apps/customer/test/unit/format.test.ts`

**Interfaces:**
- Produces: `formatDate(iso: string): string` → `22 Jan 2027`; `expiryLabel(iso: string, now?: Date): string` → `in 12 days` / `today` / `tomorrow`; `typeLabel(type: string): string` → `Earned`, `Expired`, `Adjusted`, `Clawback`; `normalizeCode(raw: string): string` (digits only, max 6).

- [ ] **Step 1: Add dependencies and config**

Dependencies: `expo`, `react`, `react-native`, `react-dom`, `react-native-web`,
`@supabase/supabase-js`, `@react-native-async-storage/async-storage`,
`react-native-qrcode-svg`, `react-native-svg`. Dev: `typescript`, `@types/react`.
Scripts: `dev:web` = `expo start --web --port 8081`, `build` = `expo export --platform web`, `typecheck` = `tsc --noEmit`.
`metro.config.js`: standard Expo monorepo config with `watchFolders = [workspaceRoot]` and `nodeModulesPaths = [project, workspace]`.
`App.tsx`: one centered `<Text>BOKPOINTS</Text>` for now.

- [ ] **Step 2: The gate — prove the toolchain in this pnpm workspace**

Run: `pnpm --filter @bokpoints/customer exec expo export --platform web`
Expected: a `dist/` directory with `index.html`.
If Metro cannot resolve the workspace, **stop and report to the owner** with the error. Do not change `.npmrc`/`node-linker` for the whole repo without approval (design risk section).

- [ ] **Step 3: Write the failing unit tests**

`apps/customer/test/unit/format.test.ts` — assertion table for the four helpers, including `expiryLabel('…T00:00:00Z', new Date('2026-10-23T10:00:00Z')) === 'in 12 days'`, and `normalizeCode(' 12a34 56 ') === '123456'`.

- [ ] **Step 4: Run them and see them fail**

Run: `pnpm exec vitest run --project unit apps/customer/test/unit/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the helpers**

Pure functions, no React Native imports, so the unit project can run them in Node.

- [ ] **Step 6: Run the tests and the typecheck**

Expected: PASS; `pnpm --filter @bokpoints/customer typecheck` clean.

- [ ] **Step 7: Commit**

```bash
git add apps/customer pnpm-lock.yaml
git commit -m "Scaffold the Expo customer app and its pure helpers"
```

---

### Task 7: Sign-in, onboarding, home QR and store history

**Files:**
- Create: `apps/customer/src/lib/api.ts`, `apps/customer/src/lib/session.ts`
- Create: `apps/customer/src/screens/SignIn.tsx`, `Onboarding.tsx`, `Home.tsx`, `StoreHistory.tsx`
- Modify: `apps/customer/App.tsx` (state machine)

**Interfaces:**
- `session.ts`: `supabase` (AsyncStorage persistence, `detectSessionInUrl: false`), `signInWithEmail(email)`, `verifyEmailCode(email, code)`, `signOut()`, `accessToken()`, `onAuthChange(handler)`.
- `api.ts`: `getMe(token)`, `updateMe(token, { name?, language? })`, `getStores(token)`, `getHistory(token, storeId)`, `getExpiring(token)`; typed `ApiError { status, code }`; base URL from `EXPO_PUBLIC_API_BASE` (default `http://127.0.0.1:3000`).
- `App.tsx` phases: `loading → signed-out → onboarding → ready`. `onboarding` when `onboardingComplete === false`; `ready` renders Home; Home can push a history screen for one store.

- [ ] **Step 1: Session and API clients**

No tests here (thin wrappers); the next step's screens exercise them.

- [ ] **Step 2: Sign-in screen**

Email → `signInWithEmail`; code field (6 digits, `normalizeCode`) → `verifyEmailCode`; resend disabled for 30 s with a countdown; errors in plain words ("That code did not work — wait for the next one"), never raw Supabase text.

- [ ] **Step 3: Onboarding screen**

First name (required, trimmed 1–100) and language (`fi`/`en`, default `fi`), saved with `updateMe`, then phase `ready`. This screen comes before the QR is ever shown.

- [ ] **Step 4: Home screen**

The QR of `credential.identifier` via `react-native-qrcode-svg` on white with a quiet zone, the customer's first name, a hint to raise screen brightness, the expiring-soon banner when `getExpiring` returns items (`formatDate`), and the store list (`name`, balance, last activity). Pull to refresh. Sign out in the header.

- [ ] **Step 5: Store history screen**

Calls `getHistory`; rows show `formatDate(createdAt)`, `typeLabel(type)`, signed points and `balanceAfter`; back returns to Home.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @bokpoints/customer typecheck`, `pnpm lint`, `pnpm exec vitest run --project unit apps/customer`, then `pnpm --filter @bokpoints/customer exec expo export --platform web`.
Expected: all clean; `dist/` produced.

- [ ] **Step 7: Sign-out check**

Tap sign out and confirm the app returns to the email field with no QR, name, balance or history left in memory or on screen, and that signing in again re-fetches rather than reusing the old customer.

- [ ] **Step 8: Commit**

```bash
git add apps/customer
git commit -m "Build the customer sign-in, onboarding, QR and history screens"
```

---

### Task 8: Live run and documents

**Files:**
- Modify: `docs/DECISIONS.md` (D-111, D-112)
- Modify: `docs/HANDOFF.md` (Build 8 row, counts, next steps)
- Modify: `handoff/STATUS.md`, `handoff/RUNBOOK.md`

- [ ] **Step 1: Live run**

Start `pnpm dev` (API + till) and `pnpm --filter @bokpoints/customer dev:web` (app on :8081). Sign in with an email the owner can read, complete onboarding, scan the QR on the till, award points, confirm the balance and history appear. Record what was seen.

- [ ] **Step 2: Documents**

D-111: customer identity (auth_user_id, email claim-and-link, `CUS-` credential, no customer id in URLs).
D-112: the customer slice (Expo + web export, English v1, CORS allow-list, 14-day window, last 100 entries).
HANDOFF: Build 8 row with test counts and the live result; move "customer app" out of Next.
STATUS: Done / Next / tests count; RUNBOOK: the customer dev command, `EXPO_PUBLIC_*`, `CORS_ORIGINS`, and how to sign in by email.

- [ ] **Step 3: Full verification**

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm --filter @bokpoints/customer exec expo export --platform web`.
Expected: all pass; record the counts.

- [ ] **Step 4: Commit**

```bash
git add docs handoff
git commit -m "Record the customer app in the handoff"
```

Push only on the owner's word.
