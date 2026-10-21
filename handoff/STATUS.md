# STATUS

**Project:** BOKPOINTS, a B2B2C loyalty platform for SMEs in Finland / EU.
**Phase:** MVP, build order steps 1 and 2 of `AGENT.md` section 13 are done.
**Last updated:** 21 Oct 2026.

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
- **Database schema.** 13 tables from the FRD section 3 data model, with Drizzle
  migrations, a CHECK that keeps entry points pointing in the right direction, and
  database triggers that make the ledger and the audit log append-only.
- **Ledger write path** in `apps/api/src/db/ledger.ts`: award with idempotency, manual
  adjustment, admin fraud clawback, balance read. All in single transactions, with the
  balance update guarded in SQL so concurrency cannot drive a balance negative.
- **API**: Fastify, versioned under `/v1`, with the three operations the Cashier screen
  needs (identify, award, balance), a pluggable session resolver, and an OpenAPI
  document generated from the same Zod schemas that validate the requests.
  Every call is authenticated, scoped to one store and permission-checked on the server.
- **Guards on the write path**: a suspended or offboarded store cannot award, a
  deactivated staff account cannot get in, a deleted customer cannot be awarded, a
  lost or revoked credential does not resolve, a replay with a different amount is
  refused, and the scanning and awarding endpoints are rate limited.
- **Point batches**: every award creates a batch that records its expiry date and its
  remaining points. Adjustments and clawbacks draw the batches down, so the expiry
  job cannot take the same points twice.

**Tests: 42 unit, 53 integration, all passing.**

## In progress

Nothing. The last task is finished.

## Blocked

- **Providers are not chosen.** Supabase, Stripe, the email provider and the hosting
  providers are all still open (`docs/DECISIONS.md` D-059). The award endpoint
  authenticates through the `SessionResolver` interface, but the resolver that
  actually verifies a Supabase token is not written yet, so the API runs on the
  development resolver (off by default, never in production). Billing and the
  customer app cannot be built end to end until at least Supabase and Stripe are picked.
- **The offline QR design is not final.** D-022 is still `Proposed`. It is the highest
  technical risk in the MVP and needs an architecture decision before it is built.

## Next

In the order of `AGENT.md` section 13:

1. **The Supabase session resolver.** Implement `SessionResolver` in
   `apps/api/src/auth/session.ts` and the award endpoint authenticates for real.
   Staff and admin accounts also need MFA (FR-AUTH-2). Needs Supabase.
2. **The points expiry job.** See below.
2. **Cashier screen, online flow only**, with the confirm step (build step 4).
   `apps/web` is a stub today.
3. **Customer app**: sign-up, QR, per-store balances and history, expiry notices
   (build step 5). `apps/customer` is a stub today.
4. **Pending customers, manual adjustments in the UI, fraud clawback, audit log**
   (build step 6). The ledger side of adjustments and clawbacks already works.
5. **Billing with Stripe** and the failed-payment states (build step 7).
6. **Offline awarding**: signed QR, device verification, encrypted queue, sync and
   rejections (build step 8). Highest risk, so prototype the QR and sync early.
7. **Reports, hardening, accessibility pass, store submissions** (build step 9).

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
