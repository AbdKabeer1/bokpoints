# Build 6A Implementation Plan — pending customers and store/admin actions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cashier can register a customer by email and award them points; an owner or manager can adjust a balance; an admin can claw back; both can read the audit log.

**Architecture:** Five new Fastify routes over the existing transactional ledger, one new capability, shared zod schemas, and one new till screen state. No schema change: a pending customer is a `customers` row with `auth_user_id IS NULL`.

**Tech Stack:** TypeScript strict, Fastify 5 + Zod, Drizzle, PostgreSQL 17, React + Vite (till), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-pending-customers-and-adjustments.md`

## Global Constraints

- No schema or migration change.
- The ledger functions are reused as they are; no rules are re-implemented in routes.
- Capability checks on the server for every route (FR-AUTH-6).
- Adjustments never below zero; clawback may, admin only; reasons required.
- Tests run from the repo root with `--project integration` / `--project unit`.
- Migrations 0007/0008 stay local; nothing hosted without the owner's word.

## Review Focus

- Registering the same email twice must return one customer, never two.
- An email that already belongs to a real account must be reused, not duplicated.
- A cashier must not reach adjustments or the customer list; an admin must not adjust through the store route.
- An adjustment that would go below zero must fail with the ledger's own error, and the balance must not move.
- The audit list must show the action that just happened, newest first, and never allow writing.

---

### Task 1: Capability, schemas, registration endpoint

**Files:**
- Modify: `packages/shared/src/permissions.ts` (`customers.register`)
- Modify: `packages/shared/src/schemas.ts` (register request/response, customer list)
- Modify: `apps/api/src/db/customers.ts` (`registerStoreCustomer`)
- Modify: `apps/api/src/routes/customer.ts`? No — staff routes stay in `apps/api/src/routes/stores.ts` or a new `apps/api/src/routes/store-customers.ts`.
- Create: `apps/api/src/routes/store-customers.ts`
- Modify: `apps/api/src/app.ts` (register)
- Test: `apps/api/test/integration/store-actions.test.ts` (new)

**Interfaces:**
- Produces: `registerStoreCustomer(db, { storeId, email, name?, staffId })` → `{ customerId, firstName, email, balance, pending }`, idempotent by lowercased email.
- `POST /v1/stores/:storeId/customers` body `{ email, name? }` → 201 `{ customerId, firstName, email, balance, pending }`.
- `GET /v1/stores/:storeId/customers?query=` → `{ customers: [{ customerId, name, email, balance, pending, joinedAt }] }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('registers a customer by email and returns them ready for an award', async () => {
  const res = await post('/v1/stores/<store>/customers', cashierToken, { email: 'new@test.dev', name: 'Aino' });
  expect(res.statusCode).toBe(201);
  expect(res.json()).toMatchObject({ email: 'new@test.dev', firstName: 'Aino', balance: 0, pending: true });
});

it('returns the same customer when the same email is registered twice', async () => {
  const first = await post(..., { email: 'new@test.dev' });
  const second = await post(..., { email: 'NEW@test.dev' });
  expect(second.json().customerId).toBe(first.json().customerId);
  // exactly one customers row
});

it('reuses an existing account with that email instead of duplicating it', async () => {
  // customers row with auth_user_id set, email 'known@test.dev'
  const res = await post(..., { email: 'known@test.dev' });
  expect(res.json()).toMatchObject({ customerId: existingId, pending: false });
});

it('refuses a customer token and a cashier from another store', async () => { ... });
it('creates the store link so the customer appears in the list', async () => { ... });
```

- [ ] **Step 2: Run to fail**
- [ ] **Step 3: Add the capability and schemas**
- [ ] **Step 4: Implement `registerStoreCustomer` and the routes, register the plugin**
- [ ] **Step 5: Run to pass, then commit**

---

### Task 2: Manual adjustment endpoint

**Files:** `apps/api/src/routes/store-customers.ts`, `packages/shared/src/schemas.ts`, tests.

**Interfaces:**
- `POST /v1/stores/:storeId/customers/:customerId/adjustments` body `{ points, reason }` (points non-zero int, |points| ≤ 1,000,000, reason 3–500 chars trimmed) → `{ entryId, balance }`.
- Capability `points.adjust` (owner, manager; admin support allowed by the matrix).

- [ ] **Step 1: Failing tests** — add 10 → balance 10; remove 4 → 6; remove 100 → 400/409 with `BALANCE_WOULD_GO_NEGATIVE`, balance unchanged; missing reason → 400; cashier → 403; an audit entry `points.adjust` exists.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement**, calling `recordAdjust` and mapping `LedgerError` through `LEDGER_ERROR_STATUS`.
- [ ] **Step 4: Run to pass; commit.**

---

### Task 3: Admin clawback endpoint

**Files:** `apps/api/src/routes/admin.ts` (add), schemas, tests.

**Interfaces:**
- `POST /v1/admin/stores/:storeId/customers/:customerId/clawback` body `{ points, caseNote }` → `{ entryId, balance }`; admin only; may go below zero.

- [ ] **Step 1: Failing tests** — balance 3, clawback 8 → −5; link status `under_fraud_review`; audit `points.fraud_clawback`; owner token → 403; empty case note → 400.
- [ ] **Step 2–4:** fail, implement with `recordFraudClawback`, pass, commit.

---

### Task 4: Audit log reading

**Files:** `apps/api/src/routes/store-customers.ts` (store), `apps/api/src/routes/admin.ts` (platform), schemas, tests.

**Interfaces:**
- `GET /v1/stores/:storeId/audit?action=&limit=` → `{ entries: [{ id, action, actorEmail, targetType, targetId, reason, createdAt, before, after }] }`, newest first, limit 1–100 default 50.
- `GET /v1/admin/audit?storeId=&action=&limit=` → the same, store name included.

- [ ] **Step 1: Failing tests** — the adjustment from Task 2 appears for the owner, newest first; `action=points.adjust` filters; a cashier gets 403; another store's owner sees nothing; admin sees it across stores.
- [ ] **Step 2–4:** fail, implement the two reads with a join to `staff_users` for the actor email, pass, commit.

---

### Task 5: The till's "customer without the app" flow

**Files:** `apps/web/src/api.ts` (`registerCustomer`), `apps/web/src/Till.tsx` (button, email/name form, state), `apps/web/test/unit/*` for email validation if extracted.

**Interfaces:**
- `registerCustomer(token, storeId, { email, name? })` → the registration shape.

- [ ] **Step 1:** Add the API client call and a failing unit test for `isEmail` (trim, one @, a dot, no spaces).
- [ ] **Step 2:** Implement the form: visible under the scan field and after a failed scan; on success the customer card renders exactly as after a scan; on failure the message is a sentence, not a code.
- [ ] **Step 3:** `pnpm --filter @bokpoints/web typecheck`, `pnpm lint`, `pnpm --filter @bokpoints/web build`, manual live check.
- [ ] **Step 4:** Commit.

---

### Task 6: Documents and verification

- [ ] DECISIONS D-113 (pending = unlinked row; registration capability; invitations deferred), D-114 (audit reading and limits).
- [ ] HANDOFF Build 9 row, counts, next steps; STATUS; RUNBOOK endpoints + the till flow.
- [ ] Full verification: typecheck, lint, unit, integration, both web builds.
- [ ] Commit. Push only on the owner's word.
