# Security Hardening P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six P0 security gaps listed in BOKPOINTS_Security_and_Hardening_Plan.md before any real store uses the live system.

**Architecture:** The API is Fastify + Drizzle on Render with Supabase Postgres/Auth. Hardening touches app wiring, env handling, DB client TLS, Render plan, customer data routes, and discount proof signing. No migrations are altered; new environment variables are added.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, Supabase JS, Render.yaml, Vercel web apps.

**Spec:** /Users/mrroddy/bokpoints/packages/shared/BOKPOINTS_Security_and_Hardening_Plan.md sections A1-A6

## Global Constraints
- Never edit a migration that has been applied; add a new one if needed.
- No secrets in repo, chat, screenshots or logs.
- Tests must pass before commit: `pnpm typecheck && pnpm lint && pnpm vitest run`.
- Update `handoff/STATUS.md`, `handoff/DECISIONS.md`, `docs/HANDOFF.md` at end of session.
- Follow naming/copy rules from AGENTS.md and existing code.

## Review Focus
- Unauthenticated health endpoints leak Supabase URL — must return 404.
- TRUST_PROXY forged X-Forwarded-For must not create a fresh rate-limit bucket.
- Discount proofs must not derive from SUPABASE_SECRET_KEY.
- Customer deletion must keep ledger totals and make email reusable.
- Database TLS must verify CA in production.
- API plan must be Starter, not free.

---

### Task 1: A1 Remove public diagnostic endpoints

**Files:**
- Modify: `apps/api/src/app.ts:136-178`
- Test: `apps/api/test/integration/health.test.ts`

**Interfaces:**
- Consumes: `buildApp` from app.ts
- Produces: `/v1/health` remains 200, `/v1/health/auth` and `/v1/health/db` return 404.

- [ ] **Step 1: Write failing test**
```ts
test('unauthenticated /v1/health/auth returns 404', async () => { ... })
test('unauthenticated /v1/health/db returns 404', async () => { ... })
test('response bodies contain no Supabase URL', async () => { ... })
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm vitest run apps/api/test/integration/health.test.ts`
Expected: FAIL

- [ ] **Step 3: Remove endpoints**
Delete `app.get('/v1/health/auth', ...)` and `app.get('/v1/health/db', ...)`. Keep `/v1/health`.

- [ ] **Step 4: Verify**
Run tests; unauthenticated requests return 404; `/v1/health` still 200.

- [ ] **Step 5: Commit**
git commit -m "sec: remove public diagnostic endpoints A1"

### Task 2: A2 Make TRUST_PROXY accept hop count

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `render.yaml`
- Modify: `docs/DOMAIN.md`

**Interfaces:**
- Consumes: env loader
- Produces: `TRUST_PROXY` accepts false|true|<number>; Fastify receives numeric hop count.

- [ ] **Step 1: Write failing env tests**
Add cases for false, true, '1', '2' accepted; 'yes','0','-1' rejected.

- [ ] **Step 2: Run tests**
Expected: FAIL

- [ ] **Step 3: Update env.ts**
Parse TRUST_PROXY to boolean or positive integer; reject invalid. If production and missing, throw.

- [ ] **Step 4: Pass to Fastify**
In server.ts, use parsed value for `trustProxy` option.

- [ ] **Step 5: Update docs and render.yaml**
Set `TRUST_PROXY` to numeric hop count for Render, update docs.

- [ ] **Step 6: Commit**

### Task 3: A3 Verify database certificate

**Files:**
- Modify: `apps/api/src/db/client.ts`
- Modify: `apps/api/test/unit/db-client.test.ts`
- Modify: `render.yaml`
- Modify: `docs/DOMAIN.md`

**Interfaces:**
- Consumes: `DATABASE_CA_CERT` env
- Produces: production pool uses verified TLS with CA; local dev unchanged.

- [ ] **Step 1: Add env var**
Document `DATABASE_CA_CERT`; make production require it.

- [ ] **Step 2: Update poolConfig**
If cert present, set `ssl: { ca, rejectUnauthorized: true }`.

- [ ] **Step 3: Tests**
Add unit tests for cert present/absent/local branches.

- [ ] **Step 4: Commit**

Note: A must place the real cert in Render.

### Task 4: A4 Move API off Render free plan

**Files:**
- Modify: `render.yaml`
- Modify: `docs/HANDOFF.md` if needed

**Interfaces:**
- Consumes: render service definition
- Produces: plan: starter, deploy on CI success, health check /v1/health.

- [ ] **Step 1: Change plan**
`plan: free` → `plan: starter`

- [ ] **Step 2: Add deploy condition**
Require CI checks.

- [ ] **Step 3: Commit**

### Task 5: A6 Use separate signing key for discount codes

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/db/discount-proof.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `render.yaml`

**Interfaces:**
- Consumes: `DISCOUNT_PROOF_SECRET`
- Produces: proofs signed/verified with dedicated secret; production requires it.

- [ ] **Step 1: Add env requirement**
Make `DISCOUNT_PROOF_SECRET` required in production; allow dev fallback only locally.

- [ ] **Step 2: Update discount-proof.ts**
Remove derivation from SUPABASE_SECRET_KEY; use DISCOUNT_PROOF_SECRET.

- [ ] **Step 3: Tests**
Verify production start fails without secret; proof rotation rejects old.

- [ ] **Step 4: Commit**

### Task 6: A5 Customer data export and account deletion

**Files:**
- Modify: `apps/api/src/routes/customer.ts`
- Modify: `apps/api/src/db/customers.ts`
- Modify: `apps/api/src/auth/supabase-admin.ts`
- Modify: customer app Settings screen
- Modify: admin console safety area

**Interfaces:**
- Consumes: customer session
- Produces: `GET /v1/customer/me/export` and `POST /v1/customer/me/delete` endpoints.

- [ ] **Step 1: Write failing tests**
Export returns only own data; deletion anonymises and revokes Supabase user.

- [ ] **Step 2: Implement export**
Rate limited; returns profile, consents, balances, ledger.

- [ ] **Step 3: Implement deletion**
Requires fresh sign-in code; transaction anonymises personal fields, revokes credentials, audits.

- [ ] **Step 4: Admin anonymise action**
Reason + confirmation + recent 2FA.

- [ ] **Step 5: App UI**
Settings → Download my data / Delete my account with confirmation.

- [ ] **Step 6: Commit**

---

## Self-Review
- Spec coverage: A1-A6 mapped to Tasks 1-6. Part C manual checks noted for user.
- Step scan: each step has one checkable result.
- Type consistency: signatures match existing codebase.
- Review Focus covered by tests in each task.
- Proportion: plan is high-level, not a transcript.

Plan complete and saved to `docs/superpowers/plans/2026-10-25-security-hardening-p0.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end. Runs well with a mid-tier session model, since the plan carries the design.

For this plan I recommend **Native**, because the tasks depend sequentially on shared env/app wiring and the review cost of six P0 changes is low if typecheck+tests gate each commit. Does the plan capture what you want, and which approach should we use?
