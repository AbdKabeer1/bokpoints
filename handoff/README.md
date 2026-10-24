# BOKPOINTS handoff

**`docs/HANDOFF.md` is the canonical state document.** This folder is a thin entry
point, kept because the working-style contract asks for one. Where the two overlap,
`docs/HANDOFF.md` wins — update it first, then adjust this folder.

| File | What it is |
| --- | --- |
| [`docs/HANDOFF.md`](../docs/HANDOFF.md) | **Canonical.** Current state, next steps, blockers, session log |
| [`docs/DECISIONS.md`](../docs/DECISIONS.md) | **Canonical.** One row per decision, with the reason |
| [`docs/PRD.md`](../docs/PRD.md) | Why the product exists, for whom, scope by phase |
| [`docs/FRD.md`](../docs/FRD.md) | What the system must do. `FR-...` requirement IDs, `AC-1` to `AC-11` |
| [`AGENT.md`](../AGENT.md) | How to work in the repo: locked stack, invariants, security rules, commands |
| [`STATUS.md`](./STATUS.md) | A short Done / Next / Blocked summary |
| [`RUNBOOK.md`](./RUNBOOK.md) | Setup, run, test and deploy commands |

## The one-line goal

Ship the MVP of a B2B2C loyalty platform for small businesses in Finland / EU, built
by one person. Stores pay a monthly subscription; customers use it free. A cashier
scans a customer's QR code, enters the purchase amount, and the customer earns points
at that store. Points are per store and expire 3 months after the day they were
earned.

## Where the build is

WP0–WP3 plus the four product surfaces are built: customer app (`apps/customer`),
cashier till (`apps/web`), merchant dashboard (`apps/owner`) and platform admin
(`apps/admin`). The UI systems live in `DESIGN.md`; product truth in `PRODUCT.md`;
canonical build state and the next work are in `docs/HANDOFF.md`. Funding-dependent
pieces remain honest placeholders: billing provider, email sender/domain, image storage,
Finnish UI, and abuse flags. Next visual input is A's reference-image set; next major
technical risk is offline awarding.

## The invariants that must never break

From `AGENT.md` section 6. They hold in the code now:

1. Per-store points, never usable at another store.
2. The ledger is append-only. The database refuses an UPDATE or DELETE.
3. No reversals. Mistakes are fixed by an `adjust` entry with a required reason.
4. No negative balances, except an admin-only `fraud_clawback`.
5. Points expire 3 months after the day they were earned, oldest first.
6. Money is whole cents, points are whole numbers, no floating point.
7. Every award carries an idempotency key, scoped to the store and the customer.
8. The ledger entry, the balance update and the batch update happen in one transaction.
9. Store isolation is enforced on the server, in every query.
10. Permissions are enforced on the server, never only in the UI.
