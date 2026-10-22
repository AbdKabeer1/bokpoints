# Pending customers, adjustments, clawback, audit — design

Date: 23 Oct 2026
Status: approved by "NEXT" (build step 6), implementing 6A now.
Build step: 6, split into 6A (API + till flow) and 6B (store and admin screens).

## Intent

A cashier can serve someone who does not have the app yet (FRD 4.4), a store
owner or manager can correct a mistake (4.5), an admin can claw back a confirmed
fraud case (4.6), and the owner or admin can see what happened (FR-AUD-1/2/5).
Until now the ledger could do the adjustments and the clawback, but nothing could
reach them, and a customer without the app could not get points at all.

## What already exists

- `recordEarn`, `recordAdjust`, `recordFraudClawback` in the ledger, all
  transactional, audited, with the rules: adjustments never go below zero, a
  clawback may, batches are drawn down, the store link is marked under fraud
  review, and every write appends to `audit_log_entries` (append-only by trigger).
- Customer provisioning (D-111): a customer row with `auth_user_id` NULL whose
  email matches a sign-in is claimed — so a pending row becomes the real account
  automatically, and its ledger, batches and balances come with it.
- Capabilities: `points.adjust`, `points.fraud_clawback`, `customers.list`,
  `audit.view` (store scope for owner/manager, platform for admin).

## The core model decision: a pending customer is an unlinked customer row

No new table and no new status. A row with `auth_user_id IS NULL` is "pending":
it has points, batches and history, but nobody can sign in as it. The first
sign-in with that email claims it (FRD 4.4 step 3), because provisioning already
links unlinked rows by verified email. One concept, one code path.

The cashier's registration endpoint creates or reuses that row for the store and
returns the customer so the ordinary award flow continues. It does not send an
invitation email yet: the email provider is not chosen (D-059), and
FRD 4.4 step 2 waits for it. The app's normal sign-in is how a pending customer
claims their points today.

## 6A — API and the till flow (this round)

| Method | Path | Who | What |
| --- | --- | --- | --- |
| `POST` | `/v1/stores/:storeId/customers` | cashier, manager, owner | Register by email (optional name); creates or reuses the unlinked row and the store link; returns `{ customerId, firstName, email, balance, pending }` |
| `POST` | `/v1/stores/:storeId/customers/:customerId/adjustments` | owner, manager | `{ points, reason }`, non-zero signed points, reason required; never below zero; returns the new balance |
| `POST` | `/v1/admin/stores/:storeId/customers/:customerId/clawback` | admin | `{ points, caseNote }`; may go below zero; marks the link under fraud review |
| `GET` | `/v1/stores/:storeId/customers?query=` | owner, manager | Customer list with balances, search by name or email, 50 newest |
| `GET` | `/v1/stores/:storeId/audit?action=&limit=` | owner, manager | Newest first, 100 max, optional action filter |
| `GET` | `/v1/admin/audit?storeId=&action=&limit=` | admin | The same across stores |

New capability: `customers.register` for store roles (the FRD matrix has no row
for it; registration is the cashier's job in 4.4, and hiding it from the till
would make 4.4 impossible). Admin keeps support lookup only, as the matrix says.

The till gains a "Customer without the app" button under the scan field: email
(required) and first name (optional) → the customer card appears exactly as a
scan would, and the amount/preview/award flow is unchanged. A failed scan also
offers the button, so the cashier never has to guess.

## 6B — the screens (next round)

`apps/web` grows a small shell: the till, a store panel (customer list, adjust
dialog, audit view) and an admin panel (clawback, platform audit). No router
library; a session-scoped view switch, like the till's state machine.

## Tests

- Integration, real Postgres: registration creates one row and is idempotent by
  email; an existing account's email is returned, not duplicated; a cashier can
  register, a customer token cannot; adjustment up/down, never below zero, reason
  required, cashier and admin refused; clawback admin-only, goes negative, marks
  the link under review; audit lists newest first and filters; customer list
  shows only that store's customers; every action writes an audit entry.
- Web: the pure parts (email validation) as unit tests; the till flow verified by
  typecheck, build and a live run.

## Not now

Invitation emails (waiting for the provider), the 1-year pending-record cleanup
(FR-PRV-5, a privacy job with its own design), pagination beyond 100/50,
customer merge (FR-ADM-4), and the store/admin screens (6B).

## Calls made

- One concept for pending (unlinked row), not a second table.
- Registration is a cashier capability, not admin support.
- Adjustment and clawback reuse the existing ledger functions untouched.
- Audit is read-only, newest first, with a simple action filter; no export yet.
