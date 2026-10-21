# BOKPOINTS handoff

The canonical project documents are in `docs/`. This folder is the quick entry point.

| File | What it is |
| --- | --- |
| [`docs/PRD.md`](../docs/PRD.md) | Why the product exists, for whom, scope by phase |
| [`docs/FRD.md`](../docs/FRD.md) | What the system must do. Requirement IDs `FR-...`, acceptance criteria `AC-1` to `AC-11` |
| [`AGENT.md`](../AGENT.md) | How to work in the repo: locked stack, invariants, security rules, commands |
| [`docs/HANDOFF.md`](../docs/HANDOFF.md) | Current state, next steps, blockers, session log |
| [`docs/DECISIONS.md`](../docs/DECISIONS.md) | Why each decision was made, and which are still open |

## Goal

Ship the MVP of a B2B2C loyalty platform for small businesses in Finland / EU, built by
one person. Stores pay a monthly subscription; customers use it free. A cashier scans a
customer's QR code, enters the purchase amount, and the customer earns points at that
store. Points are per store and expire 3 months after the day they were earned.

## Deliverables so far

Build order steps 1 and 2 of `AGENT.md` section 13:

1. The pnpm monorepo, CI, lint, typecheck and test scripts.
2. The points engine in `packages/shared`: calculation, rounding, minimum and maximum
   rules, expiry, FIFO and balance rules, plus the role and capability matrix.
3. The Drizzle schema and migrations for the ledger, with the append-only triggers.
4. The transactional ledger write path: award, adjust, fraud clawback and balance.

## Acceptance criteria

The FRD acceptance criteria `AC-1` to `AC-11` are the definition of done for the MVP.
The ones covered by the work so far, and where they are tested:

| Criterion | Where it is tested |
| --- | --- |
| AC-1 Award points, 23 points for 23.80 euros | `packages/shared/src/points/calculate.test.ts`, `apps/api/test/integration/ledger.test.ts` |
| AC-2 No double award | `apps/api/test/integration/ledger.test.ts` |
| AC-3 Store isolation | `apps/api/test/integration/ledger.test.ts` |
| AC-11 No negative balance, fraud clawback allowed | `packages/shared/src/points/balance.test.ts`, `apps/api/test/integration/ledger.test.ts` |

AC-4, AC-5, AC-6, AC-7, AC-8, AC-9 and AC-10 are not covered yet. AC-6 (expiry) needs
the daily expiry job; AC-9 and AC-10 need the offline queue.

## Deadline

None set. The MVP scope is frozen by `docs/DECISIONS.md` D-006 and by `AGENT.md`
section 2: build the MVP, not v1.1 or v2.

## Non-negotiable invariants

From `AGENT.md` section 6. They hold in the code now, and every task must keep them:

1. Per-store points, never usable at another store.
2. The ledger is append-only. The database refuses an UPDATE or DELETE.
3. No reversals. Mistakes are fixed by an `adjust` entry with a required reason.
4. No negative balances, except an admin-only `fraud_clawback`.
5. Points expire 3 months after the day they were earned, oldest first.
6. Money is whole cents, points are whole numbers, no floating point.
7. Every award carries an idempotency key, scoped to the store.
8. The ledger entry and the balance update happen in one transaction.
9. Store isolation is enforced on the server, in every query.
10. Permissions are enforced on the server, never only in the UI.
