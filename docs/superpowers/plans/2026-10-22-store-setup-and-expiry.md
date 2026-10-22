# Store Setup + Points Expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin endpoints to create a store (with points rule, branches, first owner) and owner invitations for staff (optionally branch-limited), plus the daily points-expiry job — so a real award can be tested end to end without touching the database by hand.

**Architecture:** No new tables or migrations — the schema from Build 5 already covers both (`store_members.location_id` for branch limits, `points_ledger_entries` type `expire` + `points_batches` for expiry). Two new route plugins (`admin`, `staff`) follow `routes/stores.ts`; expiry lives in `src/db/expiry.ts` next to `ledger.ts`, reusing its transaction/lock/balance patterns. A thin script runs the job.

**Tech Stack:** Fastify + zod (same schemas drive validation and OpenAPI), Drizzle/pg, Vitest, pnpm workspace.

**Spec:** user request of 22 Oct 2026 ("Store setup ... The points expiry job"), STATUS.md "The next concrete task", FRD FR-STO-5/FR-PTS-8/FR-PTS-10/AC-6, D-093/D-103/D-104/D-102; permissions from `packages/shared/src/permissions.ts`.

## Global Constraints

- No schema change without `pnpm db:generate`; none expected in this plan.
- Ledger is append-only (DB triggers); batches and balances are the mutable part.
- Route errors use the one error shape `{ error: { code, message } }` (app.ts error handler).
- Roles: `store.create`, `staff.manage`, `staff.manage_cashier`, `points_rule.manage` per `permissions.ts` (admin = platform scope; owner/manager = store scope; manager may add cashiers only, FRD section 2).
- Rate bound D-093: `pointsPerEuroThousandths` int in (0, 1 000 000].
- Money = whole cents; points = whole ints; no floats.
- No floats/`any`/`as`; ESLint on every commit. Unit 45 + integration (live count) must stay green.

## Review Focus

1. **Invite for a store that does not exist** → 403 `STORE_MISMATCH` from membership check before any capability is considered (FR-PRV-4). Test: invited staff must never be able to create their way in.
2. **Manager trying to invite a manager or owner** → 403 `FORBIDDEN_ROLE` even though `staff.manage_cashier` passed the route gate. Test in Task 2.
3. **Branch-limited invite naming another store's or a closed branch** → 400 `LOCATION_INVALID`, never a silent fix. Test in Task 2.
4. **Expiry run twice on the same day** → exactly one `expire` entry per batch, the second run is a no-op (remaining = 0 gate + locks). Test in Task 3.
5. **Expiry after a manual drawdown** → only the true remainder is expired (FIFO drawdown taken earlier must not be taken twice, FR-PTS-10). Test in Task 3.

---

### Task 1: Admin store creation

**Files:**
- Modify: `apps/api/src/auth/authorize.ts` (add `authorizeAdminRequest`, `AdminAuthResult`)
- Create: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/app.ts` (register `adminRoutes`)
- Modify: `packages/shared/src/schemas.ts` (store-create request/response schemas)
- Test: `apps/api/test/integration/store-setup.test.ts` (created in this task)

**Interfaces:**
- Consumes: `authorizeAdminRequest(db, resolver, { token, anyOf })` → `{ ok: true, staffUserId, role: 'admin' } | failure` (mirrors `authorizeStoreRequest` but no store scope; 403 `FORBIDDEN` when not admin; same `MFA_REQUIRED`/deactivation handling).
- Produces: `adminRoutes: FastifyPluginAsyncZod<RouteOptions>`; `POST /v1/admin/stores` → `201 { storeId, name, status, rule: { ruleVersion, pointsPerEuroThousandths, rounding, ... }, branches: [{ id, name }], owner }`.
- Schemas (`packages/shared/src/schemas.ts`): `createStoreRequestSchema` = `{ name: string 1..200, address?: string<=400, contactName?<=200, contactEmail?<=200, pointsRule: { pointsPerEuroThousandths int 1..1_000_000, rounding?: 'floor'|'nearest' default 'floor', minPurchaseCents?: int >=0, maxPointsPerTransaction?: int >=0 }, branches?: [{ name 1..100, address?<=400 }], owner: { email, name 1..200, authUserId uuid } }`; `createdStoreBranchSchema` = `{ id, name }`; `createdStoreResponseSchema` = `{ storeId uuid, name, status, rule: { ruleVersion int, pointsPerEuroThousandths int, rounding enum, minPurchaseCents? int, maxPointsPerTransaction? int }, branches: createdStoreBranchSchema[], owner: { id uuid, email, locationId: uuid|null } }`.

Decisions: the store is created `active` (owner asked for an awardable store; the admin platform flow can pause it later). Quantity of rule fields mirrors `points_rules` columns; fields optional there too. The first owner is required at creation: no owner exists yet to invite, so `owner = { email, name, authUserId }`. Owner member rows get `locationId: null`.

- [ ] **Step 1: Write the failing tests** `store-setup.test.ts` (helper shape follows `locations.test.ts`): admin via dev resolver (`is_admin = true` staff row) can create a store with two branches + rule + owner and gets `201`; the response's rule echoes the request; a `store_owner` token on this endpoint is 403 `FORBIDDEN`; a cashier token is 401 as usual; response codes from `authorizeStoreRequest` style errors preserved.
- [ ] **Step 2: Run** `pnpm exec vitest run --project integration test/integration/store-setup.test.ts` → FAIL (route 404).
- [ ] **Step 3: Implement** `authorizeAdminRequest` + `createStoreWithRule` logic in `routes/admin.ts` (transaction: insert store, rule v1, branches, owner `upsertStaffAccount` + `storeMembers` row, audit entry `store.create`); register plugin in `app.ts`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: admin creates stores with rule, branches and first owner`.

### Task 2: Owner/manager staff invitations

**Files:**
- Create: `apps/api/src/routes/staff.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/shared/src/schemas.ts` (`inviteStaffRequestSchema`/`invitedStaffResponseSchema`)
- Test: appendix to `store-setup.test.ts`

**Interfaces:**
- Produces: `staffRoutes` plugin; `POST /v1/stores/:storeId/staff` → `201 { memberId, storeId, role, locationId: string|null, status: 'active' }`.
- Schemas: `inviteStaffRequestSchema` = `{ email, name 1..200, authUserId uuid, role: 'manager'|'cashier', locationId?: uuid }`; `invitedStaffResponseSchema` as above.
- Authorization: `authorizeStoreRequest(..., anyOf: ['staff.manage', 'staff.manage_cashier'])`; then refine: caller role `store_manager` may only invite `role === 'cashier'` (403 `FORBIDDEN_ROLE` otherwise). `store_owner`/`admin` may invite both. Owner role is NOT invitable (ownership change is a separate future flow; `owner` role value never accepted in this endpoint — validation error).
- Branch rule: `locationId` is honored only if it is an `active` branch of THIS store; anything else (closed, foreign) → 400 `LOCATION_INVALID` (same words/codes as awards). Composite FK backstops.

- [ ] **Step 1: Failing tests**: owner invites a cashier branch-limited; owner invites a manager store-wide; manager invites a cashier; manager inviting a manager → 403 `FORBIDDEN_ROLE`; invite naming a closed branch → 400 `LOCATION_INVALID`; non-member of the store (cashier from another store) → 403 `STORE_MISMATCH`; audit entry written with actor.
- [ ] **Step 2: Run** → FAIL (404).
- [ ] **Step 3: Implement** `routes/staff.ts` (reuse `upsertStaffAccount` — idempotent by lower(email) D-094; insert `store_members`; audit `staff.invite`).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: owners and managers invite staff, optionally limited to one branch`.

### Task 3: The expiry write path

**Files:**
- Create: `apps/api/src/db/expiry.ts`
- Test: `apps/api/test/integration/expiry.test.ts`

**Interfaces:**
- Consumes: `recordEarn` (to create real batches through the real path), `applyBalanceDelta` (reused if exported — else copy `readBalance`/`applyGuardedBalanceDelta` locally or export them; decision: export `readBalance` and `applyGuardedBalanceDelta` from `ledger.ts`).
- Produces: `runExpiry(db, { asOf?: Date, chunkSize?: number } = {}) : Promise<{ expiredEntries: number; pointsExpired: number }>`.
  Behavior: loop chunks of `points_batches` where `remaining_points > 0 and expires_at <= asOf` order by `expires_at` asc `.for('update')` (same lock semantics as adjustments, D-xxx). Per batch inside one transaction: re-read remaining under lock, guard > 0; insert ledger `{ type: 'expire', points: -remaining, customerId, storeId, expiresAt: batch.expiresAt }`; `UPDATE points_batches SET remaining_points = 0`; `applyGuardedBalanceDelta(-remaining)` (invariant: balance ≥ Σ remaining batches; loud failure if broken); audit `points.expire` with null actor (system job). Sum counters across chunks.

- [ ] **Step 1: Failing tests** `expiry.test.ts`: (a) expire one batch fully — balance drops by the batch, one `expire` entry, `remaining_points = 0`; (b) second run same day → nothing new (idempotent); (c) two parallel `runExpiry` calls → total expired exactly once (locks serialize); (d) award 100, adjust −30, force expiry → expire entry is −70 (FIFO drawdown respected); (e) multiple customers/stores never cross (store A expiry forgets store B); (f) `reason =` stores the batch's earn entry id reference? — decision: `reason` stays null, `expiresAt` carried; audit `after: { points, batchId }`.
- [ ] **Step 2: Run** → FAIL (`runExpiry` not exported).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: points expiry job, once per batch, safe to re-run`.

### Task 4: The executable job + demo wiring

**Files:**
- Create: `apps/api/scripts/expiry-run.ts`
- Modify: `apps/api/package.json` (`"expiry:run": "tsx --env-file-if-exists=.env scripts/expiry-run.ts"`)
- Test: covered by integration suite + `pnpm expiry:run` against local dev DB in the live check.

- [ ] **Step 1: Implement** the script mirroring `scripts/demo.ts` env handling (`--env-file-if-exists=.env` in package.json line, `loadEnv` not needed — pool from `DATABASE_URL`), prints `Expired N batches, M points across 0 customers`… keep simple: `{ expiredEntries, pointsExpired }`.
- [ ] **Step 2: Run** `pnpm typecheck && pnpm lint` → clean. **Step 3: Commit** `feat: expiry:run script`.

### Task 5: Docs + final green sweep

**Files:** Modify `docs/DECISIONS.md` (D-107 store setup endpoints, D-108 expiry design), `docs/HANDOFF.md` + `handoff/STATUS.md` (counts + next-state), `handoff/RUNBOOK.md` (`expiry:run` line, invite/curl snippets optional — keep one line each).

- [ ] **Step 1: Full sweep** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration` (45+X unit / 111+Y int all green).
- [ ] **Step 2: Commit** `docs: record store setup and expiry decisions`.

### End-of-build live check (after tasks)

Actual supabase flow: kill `:3000` stale server; `pnpm dev` fresh (local DB); create live Supabase user via admin API with the secret key (email+password); `pnpm bootstrap:admin --auth-user-id <uid>`; `pnpm staff:login` (MFA enrol first run); then exercise the new endpoints end to end: create store (with rule+branch+second owner), invite cashier branch-limited, award through the live token. Only after this: `pnpm expiry:run` against local DB for the smoke, since data is in dev.
