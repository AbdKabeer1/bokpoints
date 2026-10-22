# Cashier screen v1 — design

Date: 22 Oct 2026
Status: approved in chat ("go"), building.
Build step: 4 (online only). Related: FR-STO-9, FR-PTS-2/4/8, FR-API-1, FRD section 2, AC-2.

## Goal

A cashier at a till can, in one flow: sign in, scan the customer's member code
with the till's hardware scanner, see who it is and their balance, type the
purchase amount, see the points that will be awarded *before* committing,
confirm, and see the result. Online only. No offline queue (build step 8), no
camera scanning, no discounts/campaigns (post-MVP, HANDOFF.md line 47).

## What the till looks like

The device is the counter's laptop or tablet, on the till's browser (installable
as a PWA per the locked stack in AGENT.md section 3).

**Scanner behaviour.** A bioptic / OEM scan engine acts as a keyboard: it types
the code and presses Enter. The screen therefore has a focused input and treats
"text + Enter" as a scan. A human can type or paste a code and press Enter as a
fallback. No camera code, no QR library.

The code alone does not say whether it is an app QR or a physical card, so the
identify call is attempted as `app_qr` first and, if nothing matches, once more
as `nfc_card`. One clear "code not recognised" error either way.

## The flow (one screen, staged)

1. **Sign in.** Email + password, then a 6-digit authenticator code. A staff
   member with no authenticator yet is shown a set-up step: the secret as
   text, a code field, and the QR rendered by the authenticator app's standard
   `otpauth://` URI. Sessions persist (a till survives a page reload); there is
   a visible sign-out.
2. **Store.** `GET /v1/me` returns the caller and their memberships. One
   membership → chosen automatically. Several → a short picker. None → "ask
   your owner to invite you".
3. **Scan.** Focused input; scanner or manual entry; Enter → identify.
4. **Customer card.** First name, balance at this store, and the branch the
   award will be recorded at (the cashier's own branch when they are limited to
   one, D-103/D-104).
5. **Amount.** The cashier types what the register charged. A live preview
   (debounced) shows "earns N points, expiring D Month YYYY"; a refusal
   (below minimum) shows its reason, not an error.
6. **Confirm.** One button. The award is sent with a fresh `Idempotency-Key`
   (UUID), so a double tap or a retry cannot award twice (AC-2).
7. **Result.** Points awarded, the new balance, expiry date, "next customer"
   resets to step 3. Errors are shown in plain words and the scan field takes
   focus back.

## API additions (all small, none changes existing behaviour)

- **`GET /v1/me`** — any active staff token. Returns
  `{ staff: { id, email, name, isAdmin }, memberships: [{ storeId, storeName, role, locationId, locationName, status }] }`.
  Needs no store id, so it comes before the store is known. Deactivated
  account → 403 `ACCOUNT_DEACTIVATED`, missing token → 401.
- **`POST /v1/stores/:storeId/awards/preview`** — same body as the award
  (without the idempotency header), same capability (`points.award`), same
  branch rules. Returns `{ points, awarded, reason?, expiresAt, locationId,
  locationName }` and **writes nothing**. Points maths stays on the server
  (one place, the rule version is authoritative); a below-minimum purchase is
  a 200 with `awarded: false` and a reason, because it is a normal till moment,
  not a failure.
- Shared zod schemas for both, so validation and OpenAPI stay in one place.

## Web app shape

`apps/web`: React + Vite + TypeScript, PWA manifest and a minimal service
worker (installable; **no** offline queue). No router and no state library —
one auth state, one till state machine. Dependencies: `react`, `react-dom`,
`@supabase/supabase-js`, the shared workspace package, and Vite/React dev
tooling. Dev runs against the API through Vite's `/v1` proxy, so no CORS
configuration is needed locally; a deployed build points at the API origin via
`VITE_API_BASE`, where an allow-list would be added with the deploy.

Session handling: `supabase-js` with `persistSession` on (localStorage) and
`autoRefreshToken` on. The API token is read per request; `aal2` is required by
the API (D-101) and the screen keeps the MFA step until it is reached.

UI language for v1: English strings in one module (the FRD's Finnish/English
pass comes with the design work; the cashier's target user is Finnish, so this
is a deliberate v1 shortcut, recorded as a decision).

## Tests

- API integration (real Postgres, dev resolver): `/v1/me` for owner, cashier
  (branch shown), admin (no memberships), deactivated, no token; preview for a
  normal purchase, below minimum, limited cashier auto-branch, foreign store,
  non-awarding store, and "writes nothing".
- Web unit (pure logic): scan normalisation, euro-string → integer cents,
  API error code → cashier-facing sentence, debounce/state helpers where pure.
- Manual live smoke: sign in on `localhost:5173` with a real Supabase account,
  enrol an authenticator, scan `CUST-QR-0001`, award on Kahvila Bea.

## Out of scope (explicit)

Camera scanning; membership-card type selection UI; offline queue and sync;
discounts, campaigns, redemption (post-MVP); store dashboard and admin UI;
true POS integration (later calls these same endpoints).

## Open for later

- Physical cards read by a terminal: today they map to the `nfc_card`
  credential type. Whether barcoded cards deserve their own type (or reuse
  `nfc_card` as "opaque physical card") is a v1.1 schema question.
- Finnish UI strings, idle auto sign-out, receipt printing.
