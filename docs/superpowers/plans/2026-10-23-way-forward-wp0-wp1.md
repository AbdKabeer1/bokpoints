# The Way Forward — WP0 and WP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two security bugs the Way Forward names (4.1 invite takeover, 4.2 unverified email), then apply its document changes (WP1).

**Source:** `BOKPOINTS The Way Forward.md` (product owner, 23 Oct 2026). Its work packages WP2–WP8 are not in this session.

**Spec facts confirmed in code before planning:**
- `upsertStaffAccount` overwrites `name`, `is_admin`, `auth_user_id` on conflict, and is used by the invite route (`routes/staff.ts:95`), admin store creation (`routes/admin.ts:109`) and `scripts/bootstrap-admin.ts`. → 4.1 confirmed.
- A real Supabase access token has **no** verified-email claim (decoded live: `sub`, `email`, `aal`, `role`, `session_id`, `app_metadata.provider`) → 4.2's "check the claim in the token" is impossible; the check must be server-side. The Auth Admin API with `SUPABASE_SECRET_KEY` returns `email_confirmed_at` (verified live, 200).
- `provisionCustomer` sets `emailVerifiedAt = now()` without any proof → 4.2 confirmed.
- Invite tests live in `apps/api/test/integration/store-setup.test.ts`; customer provisioning tests in `apps/api/test/integration/customer-app.test.ts`.

## Global Constraints

- Never edit an applied migration; no migration is needed for WP0.
- `upsertStaffAccount` keeps its behaviour for the bootstrap script only (Way Forward 4.1).
- Fail closed: a verifier that cannot reach Supabase means "not verified".
- Tests run from the repo root: `pnpm test`, `pnpm test:integration`.
- Doc numbering: D-113 and D-114 are taken by Build 9, so the Way Forward's D-113..D-124 become **D-115..D-126**.

## Review Focus

- Inviting an existing email changes nothing on that account (name, `is_admin`, `auth_user_id`).
- The Supabase-id-refusal fires whether the invited email is new or existing.
- Unverified sign-in creates and claims nothing, and the error is a sentence the customer app shows.
- Bootstrap still overwrites (it is the administrative setup path).

---

### Task 1: 4.1 — invites never alter an existing account

**Files:** `apps/api/test/integration/store-setup.test.ts`, `apps/api/src/db/staff.ts`, `apps/api/src/routes/staff.ts`, `apps/api/src/routes/admin.ts`.

- [x] **Step 1: Red tests** — existing admin email invited by an owner with a different Supabase id: 201 with membership added, account row byte-identical (`name`, `is_admin`, `auth_user_id`). Supabase id already linked to another account → 409 `AUTH_USER_ALREADY_LINKED`, no account, no membership. Second invite of the same email to the same store → 409 `ALREADY_MEMBER`. Admin creating a store whose owner email already exists → account unchanged.
- [x] **Step 2: Run to fail.**
- [x] **Step 3: Implement** `createStaffAccountForInvite` (create-if-new, never update, refuse a linked-elsewhere Supabase id) + `StaffAccountError`; invite route adds the already-member check and 409s; admin store creation uses the same helper; `upsertStaffAccount` docstring narrows to the bootstrap script.
- [x] **Step 4: Run to pass, typecheck, commit.**

### Task 2: 4.2 — a verified email before create or claim

**Files:** `apps/api/src/auth/supabase-admin.ts` (new), `apps/api/src/auth/session.ts`, `apps/api/src/auth/supabase-session.ts`, `apps/api/src/auth/dev-session.ts`, `apps/api/src/routes/customer.ts`, `apps/api/src/db/customers.ts`, tests.

- [x] **Step 1: Red tests** — a customer resolver that reports an unverified email → `POST /v1/customers/me` answers 403 `EMAIL_NOT_VERIFIED` and creates nothing; same token for an unlinked row already in the database → refuses to claim it, row untouched. Unit test for the verifier: 200 with `email_confirmed_at` → true; null → false; network failure or 500 → false (fail closed); missing secret key → false.
- [x] **Step 2: Run to fail.**
- [x] **Step 3: Implement** — `createEmailVerifier` (Auth Admin API), `isEmailVerified` on `CustomerSessionResolver` (Supabase: real check; dev: returns true, local mode only), `provisionCustomer(db, principal, isEmailVerified?)` refuses before create/claim, route passes it, 403 mapped to a plain sentence.
- [x] **Step 4: Run to pass, typecheck, commit.**

### Task 3: WP0 hygiene and the live data check

- [x] Fix the unindented transaction block in `customers.ts` (Way Forward 4.4) while touching the file.
- [x] Read-only check of `staff_users` in the hosted database (email, name, `is_admin`, link present) — nothing looks hijacked or duplicated.
- [x] Record the deferred 4.4 items (customer app secure storage, till idle sign-out) in STATUS as next-up, with the reason: `expo-secure-store` has no web build and the customer app currently ships web.

### Task 4: WP1 — documents

- [x] `docs/DECISIONS.md`: D-115..D-126, the Way Forward's decisions renumbered past D-113/D-114 (Build 9), plus a decision for the verified-email mechanism actually used (server-side Admin API, because the token has no such claim).
- [x] `docs/PRD.md`: the eight section-6 items.
- [x] `docs/FRD.md`: FR-RUL, FR-CHK, FR-SAL families; the changed requirements; the new capability in section 2; the two new tables in section 3; parked families marked later; AC-12..AC-17.
- [x] `docs/HANDOFF.md` and `handoff/STATUS.md`: WP0 done, WP1 done, WP2 next, current test counts, link to the Way Forward as the plan of record.
- [x] Commit.

### Task 5: Verification

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, both web builds.
- [x] Report Done / Next / Blocked; push only on the owner's word.
