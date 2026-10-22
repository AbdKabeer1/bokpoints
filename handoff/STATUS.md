# STATUS

**Project:** BOKPOINTS, a B2B2C loyalty platform for SMEs in Finland / EU.
**Phase:** MVP, build order steps 1 and 2 of `AGENT.md` section 13 are done.
**Last updated:** 22 Oct 2026, after the review round of 22 Oct (four findings implemented, three confirmed and documented).

## Done

- **Repo and tooling.** pnpm monorepo at `~/bokpoints`, private GitHub remote. CI runs
  typecheck, lint, unit tests and integration tests against a PostgreSQL 17 service.
- **PRD and FRD exported.** `docs/PRD.md` and `docs/FRD.md`, converted from the source
  PDFs. All 114 `FR-` requirement IDs and `AC-1` to `AC-11` verified against the source.
- **Points engine** in `packages/shared`, pure functions, no I/O: calculation with
  rounding, minimum purchase and per-transaction cap; expiry with the short-month clamp;
  FIFO consumption; balance and adjustment rules.
- **Role and capability matrix** in `packages/shared`, straight from the FRD section 2
  table.
- **Database schema.** 15 tables from the FRD section 3 data model, plus store branches, with Drizzle
  migrations, a CHECK that keeps entry points pointing in the right direction, and
  database triggers that make the ledger and the audit log append-only.
- **Ledger write path** in `apps/api/src/db/ledger.ts`: award with idempotency, manual
  adjustment, admin fraud clawback, balance read. All in single transactions, with the
  balance update guarded in SQL so concurrency cannot drive a balance negative.
- **API**: Fastify, versioned under `/v1`, with the three operations the Cashier screen
  needs (identify, award, balance), the Supabase session resolver, and an OpenAPI
  document generated from the same Zod schemas that validate the requests.
  Every call is authenticated, scoped to one store and permission-checked on the server.
- **Guards on the write path**: a suspended or offboarded store cannot award, a
  deactivated staff account cannot get in, a deleted customer cannot be awarded, a
  lost or revoked credential does not resolve, a replay with a different amount is
  refused, and the scanning and awarding endpoints are rate limited.
- **Point batches**: every award creates a batch that records its expiry date and its
  remaining points. Adjustments and clawbacks draw the batches down, so the expiry
  job cannot take the same points twice.
- **Review round of 22 Oct 2026** (from the external review): `TRUST_PROXY` passed to
  Fastify as `trustProxy` so the rate limiter keys on the caller behind a proxy
  (D-095); the idempotency race path refuses a different amount (D-092); batch
  drawdowns lock the rows they read (`FOR UPDATE`); the earn rate is bounded by a
  CHECK (`points_rules_rate_check` at 1,000,000 thousandths, D-093); two misplaced
  docblocks fixed; the public `/v1/openapi.json` documented in D-095.

- **Supabase auth** (D-098 to D-101): tokens are verified locally against the
  project's public keys (asymmetric only), staff and admin must have passed a second
  factor (`403 MFA_REQUIRED` otherwise), and `staff_users.auth_user_id` links a staff
  account to its Supabase user. Built and tested with locally generated keys; **not yet
  run against the live project.**
- **Store branches** (D-103, D-104): optional `store_locations`. Points stay per store,
  an award records its branch, a member can be limited to one. Solo stores are unchanged.
- **Row-level security** on every table, with no policies (D-102), checked by a test.
- **Scripts**: `pnpm bootstrap:admin` creates the first admin, `pnpm staff:login` gets a
  real second-factor token (D-105). `pnpm dev` reads `apps/api/.env`.
- **Migration journal fixed** (D-106): `0005` was missing from Drizzle's journal, so a
  real `drizzle-kit migrate` would have skipped it. It is replaced by a generated
  migration, and a test now keeps the journal and the files in step.

**Tests: 45 unit, 111 integration, all passing.**

## In progress

Nothing. The last task is finished.

## Blocked

- **Supabase is chosen in practice.** A dev project exists (`eu-north-1`, Free plan) and
  its URL, publishable and secret keys live in `apps/api/.env` (git-ignored). The hosted
  Postgres is migrated. What is still missing: running the built resolver against the
  live project (Next 1). Stripe, the email provider and the hosting providers are still
  open (`docs/DECISIONS.md` D-059); billing and the customer app cannot be built end to
  end until at least Stripe is picked.
- **The offline QR design is not final.** D-022 is still `Proposed`. It is the highest
  technical risk in the MVP and needs an architecture decision before it is built.

## Next

In the order of `AGENT.md` section 13:

1. **Run the Supabase resolver against the live project.** Set `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY` in `.env`, run `pnpm bootstrap:admin`, then
   `pnpm staff:login`, and call the API with the token. The JWKS address must return
   a key (asymmetric signing keys on).
2. **The points expiry job.** See below.
3. **Cashier screen, online flow only**, with the confirm step (build step 4).
   `apps/web` is a stub today.
4. **Customer app**: sign-up, QR, per-store balances and history, expiry notices
   (build step 5). `apps/customer` is a stub today.
5. **Pending customers, manual adjustments in the UI, fraud clawback, audit log**
   (build step 6). The ledger side of adjustments and clawbacks already works.
6. **Billing with Stripe** and the failed-payment states (build step 7).
7. **Offline awarding**: signed QR, device verification, encrypted queue, sync and
   rejections (build step 8). Highest risk, so prototype the QR and sync early.
8. **Reports, hardening, accessibility pass, store submissions** (build step 9).

### The next concrete task

The award endpoint is done, so the natural next task is **the points expiry job**, which
is pure MVP scope and needs no provider:

- A daily job that finds `earn` entries whose `expires_at` has passed and whose
  `remaining_points` is still above zero, and writes an `expire` entry for each batch.
- It reuses `expiryDateForEarn` and the FIFO rules already in `packages/shared`.
- It must be idempotent: running it twice on the same day must not double-expire.
- It needs an integration test that covers `AC-6`: points earned on 2 June are expired
  by an entry of minus 23 when the date reaches 2 September.

## Risks to watch

- **Offline awarding** is the biggest piece and the biggest fraud surface. The server
  re-validates everything at sync; never relax that because the client already checked.
- **Solo workload** across product, design, build, test and support. Hold the MVP scope.
- **Two app stores plus web** add release and review work. Plan accounts and review time
  early.
- **Cold start.** Customers see little value until several stores participate. Launch in
  one tight local cluster.
