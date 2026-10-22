# Customer app v1 — design

Date: 23 Oct 2026
Status: for approval.
Build step: 5 (customer app), the first slice of FR-CUS-1/2/3/8.
Stack: Expo (React Native) with web export, per `AGENT.md` section 3.

## Intent

A customer can open one app, see their personal QR code, and — without asking
anyone — see where they have points, what they earned and when points expire.
It has to work on a phone at the till and in a browser for a quick look.

Success: the person who just paid at Kahvila Bea opens the app, sees the award
from that visit and a QR the cashier can scan next time, and can tell whether
their points expire before their next visit.

## Goals

- Sign up and sign in with an email one-time code (FR-AUTH-1); no password.
- A home screen that opens on the QR code, large and readable (FR-CUS-1).
- Every store where the customer has points, with balance and last activity
  (FR-CUS-2).
- Per-store history: date, type, points, resulting balance (FR-CUS-3).
- Points expiring within 14 days, with dates (FR-CUS-8).
- First run: a short name step, because the till shows the first name. It comes
  before the QR is shown, so the till never meets a nameless customer.

## Non-goals for this slice

Profile editing beyond name and language, per-store notification and marketing
consent (FR-CUS-5), data export and account deletion (FR-CUS-6), lost-card /
new-QR flow (FR-CUS-7), push notifications and offers (FR-CUS-11, v1.1),
offline awarding and signed QR (build step 8), app-store submissions (step 9).
Award confirmation arrives when the customer next opens the app; a push on the
award itself is part of the notifications work.

## Anti-goals

- Seeming to confirm an award the API did not record (no optimistic balances).
- Any endpoint where a client passes a customer id it could tamper with.
- A second schema for authentication: Supabase users are the only identities.

## How it fits what exists

- The till identifies a customer by a credential `identifier` (today
  `CUST-QR-0001` for the demo customer, type `app_qr`). The customer app shows
  exactly that identifier as a QR code, so the same till path keeps working.
- Points are per store, expire 3 months after each earn, and the ledger already
  records every entry with a signed `points` value; the balance is the sum.
- Staff auth requires `aal2` (D-101). Customers are a different audience: their
  token is `aal1`, and they may only ever read their own data.

## Identity and first sign-in

Add `customers.auth_user_id` (nullable, unique) in a new migration 0007, mirroring
`staff_users.auth_user_id`. On the first authenticated customer request the API
provisions in one transaction:

1. Find the customer by `auth_user_id`.
2. Otherwise find an existing customer by case-insensitive email with
   `auth_user_id IS NULL`. Supabase has just proven the caller owns that email
   with the one-time code, so this is the FR-AUTH-3 merge, not a guess.
3. Otherwise create the customer (`email`, empty `name`, default language) and
   their first credential.

An `app_qr` credential is created when none is active:
`CUS-` + 26 base32 characters from 16 random bytes. The identifier is opaque and
unguessable; Ed25519-signed QR is build step 8 and needs no schema change here.

`name` is empty until the onboarding step sets it; `onboardingComplete` is
`name.trim() !== ''`.

## API (all customer-scoped, identity from the token, never from the URL)

New resolver: verify the same Supabase JWT, accept `aal1`, resolve to
`{ authUserId, email }`. No MFA requirement, no store scoping.

| Method | Path | Returns |
| --- | --- | --- |
| `GET` | `/v1/customer/me` | profile, active credential, `onboardingComplete`; provisions on first call |
| `PATCH` | `/v1/customer/me` | set `name` (1–100 chars) and/or `language` (`fi` or `en`) |
| `GET` | `/v1/customer/me/stores` | stores with points or activity: `storeId, name, balance, lastActivityAt` |
| `GET` | `/v1/customer/me/stores/:storeId/history` | `storeName, balance`, last 100 entries newest first: `createdAt, type, points, balanceAfter` |
| `GET` | `/v1/customer/me/expiring?days=14` | batches still alive and expiring within the window: `storeId, storeName, points, expiresAt` |

`balanceAfter` is computed in SQL with a window sum
(`SUM(points) OVER (ORDER BY created_at, id)`) over the append-only ledger. Entries
store signed points (`earn` positive, `expire` and `clawback` negative, `adjust`
either), so the running sum is the real balance at that entry.

Stores list rule: every store that appears in the customer's ledger, with its
cached balance (0 once everything expired) and `lastActivityAt` (newest entry),
newest activity first. A store they once used stays visible with a zero balance
and its history.

The expiring endpoint reads `points_batches` (`remaining_points > 0`,
`expires_at > now()`, `expires_at <= now() + days`), one row per batch with the
store name; the window is inclusive and defaults to 14 days.

Provisioning happens inside `GET /v1/customer/me` on first call. Every other
endpoint assumes it has run (the app always calls `/me` first), and a customer
row with `status = 'deleted'` is refused with `403 ACCOUNT_DELETED`. PATCH trims
`name`, rejects an empty result, and accepts only `fi` and `en`.

Dev testing: `apps/api/src/auth/dev-session.ts` gains a customer variant that
maps an email to an existing `customers.auth_user_id`, so integration tests need
no Supabase and no email.

CORS: the Expo web build is served from its own origin, so the API gets an
allow-list from `CORS_ORIGINS` (comma-separated, empty by default = no CORS).
Local `.env` allows `http://localhost:8081`. The Cashier screen keeps using the
Vite proxy and does not need it.

## The app (`apps/customer`)

Expo SDK with `expo` + React Native + `react-native-web`; session persistence via
`@react-native-async-storage/async-storage`; the QR via `react-native-qrcode-svg`
(small, maintained; drawing QR by hand would be wrong). No navigation library:
one state machine, like the till.

Screens:

1. **Sign in** — email field, then a 6-digit code field; resend with a cooldown.
2. **First run** — first name and language, saved with `PATCH /v1/customer/me`.
3. **Home** — QR code (black on white, quiet zone, brightness hint), the
   customer's name, an expiring-soon banner when any batch is within 14 days,
   and the store list with balances and last activity. Tap a store for history.
4. **Store history** — date, type, points and resulting balance; empty state.

Environment: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`EXPO_PUBLIC_API_BASE`. Web export: `expo export --platform web`.

Dev commands: the customer app is **not** part of root `pnpm dev` (Expo's dev
server is interactive and would hijack the terminal); it runs as
`pnpm --filter @bokpoints/customer dev:web` on port 8081.

## Tests

- API integration (real Postgres, dev resolver): provisioning is idempotent and
  creates exactly one credential; an existing customer row is claimed by email;
  a second customer cannot read the first customer's data; stores list excludes
  stores with no activity; history order and `balanceAfter` arithmetic across
  earn/expire/adjust; expiring window edges (inside 14 days, outside, already
  expired); PATCH validation; unauthenticated calls 401.
- App unit tests (pure modules only): date formatting, expiring grouping,
  history row labels, code input normalisation.
- Manual: sign in with a real email (Supabase sends the code), set a name, scan
  the QR at the till, award points, see them appear.

## Risks and open items

- **Expo + pnpm**: Metro sometimes needs a hoisted layout in a monorepo. If the
  SDK cannot resolve the workspace, the fallback is `node-linker=hoisted` and,
  if that breaks the API, a first slice inside `apps/web` with the same API —
  with A's approval, since the stack is locked.
- **Email delivery** uses Supabase's built-in sender for now (low rate limit).
  A transactional provider is an open decision (D-059); this slice does not
  pick one.
- **The QR is not signed** until build step 8; it is opaque and only usable at
  a till that asks the server.

## Calls made here (check these while reading)

- Linking by verified email on first sign-in, rather than asking the customer
  to enter an invite code.
- QR payload = the credential identifier the till already understands, not a
  deep link.
- `name` lives on the customer row (one name across stores), while consents are
  per store and come later.
- History limited to the last 100 entries per store; older entries are a later
  "load more".
- **UI language is English in v1**, like the till; the `language` field is stored
  (default `fi`) and the Finnish/English pass comes with the design work. This
  is a deliberate shortcut, not an oversight.
- Onboarding (first name) is mandatory before the QR appears, so a till never
  shows a nameless customer.
