# Cashier screen v1 — implementation plan

Spec: `docs/superpowers/specs/2026-10-22-cashier-screen.md`.
Work inline, TDD, commit per task. Branch: work on `main` like Build 6.

## Global constraints

- No schema/migration changes.
- Existing endpoints untouched; two new ones only (`/v1/me`, `awards/preview`).
- Errors: `{ error: { code, message } }`; ledger failures map through
  `LEDGER_ERROR_STATUS`.
- No `any`, no floats for money (integer cents), ESLint clean, unit +
  integration green, CI green.

## Task 1 — GET /v1/me

Files: `apps/api/src/auth/authorize.ts` (+`authorizeStaffRequest`,
`StaffAuthResult`), `packages/shared/src/schemas.ts` (+`meResponseSchema`),
`apps/api/src/routes/me.ts` (new plugin), `apps/api/src/app.ts` (register),
`apps/api/test/integration/me-and-preview.test.ts` (new).

Interface: `authorizeStaffRequest(db, resolver, { token })` → `{ ok: true,
staffUserId } | { ok: false, status, error }`; checks token → principal →
staff row exists + `status === 'active'`; no capability required (it is the
caller's own identity). `GET /v1/me` → 200
`{ staff: { id, email, name, isAdmin }, memberships: [{ storeId, storeName, role, locationId, locationName, status }] }`
(active memberships only, ordered by store name).

Tests: owner sees their store/role; branch-limited cashier sees `locationName`;
admin with no membership sees `[]`; deactivated staff 403; no token 401.

## Task 2 — award preview

Files: `apps/api/src/db/ledger.ts` (+`previewEarn`, `PreviewEarnResult`),
`packages/shared/src/schemas.ts` (+`awardPreviewResponseSchema`; request reuses
`awardRequestSchema`), `apps/api/src/routes/stores.ts` (+`POST
/v1/stores/:storeId/awards/preview`), same test file.

Interface: `previewEarn(db, input: { customerId, storeId, amountCents, rule,
locationId })` → `{ points, awarded, reason?, expiresAt: Date | null,
locationId, locationName }`. Reads only: store status, customer exists, branch
rules (same messages as `recordEarn`), `calculatePoints`,
`expiryDateForEarn(new Date())`.

Route: auth `points.award`; `currentRuleFor`; the same limited-member
`LOCATION_MISMATCH` check as the award route; no idempotency header; 200
always when the request is well-formed, `awarded: false` + reason for
below-minimum.

Tests: 2500¢ at rate 1000 → 25 points, `expiresAt` = today + 3 months (UTC
date), branch auto-filled for limited cashier; below minimum → `awarded:
false`, `BELOW_MINIMUM`; ledger count unchanged after preview; foreign store
403; suspended store 403 `STORE_NOT_AWARDING`.

## Task 3 — web scaffold

Files: `apps/web/{package.json,tsconfig.json,tsconfig.node.json,vite.config.ts,index.html,.env.example}`,
`apps/web/src/main.tsx`, `apps/web/src/pwa/{manifest.webmanifest,sw.js,icon.svg}`,
root `package.json` (build includes web), `eslint.config.js` (React/TSX
settings if missing).

Details: Vite + React plugin, port 5173, proxy `/v1 → http://127.0.0.1:3000`;
scripts `dev`, `build`, `preview`, `typecheck`; deps react/react-dom/
`@supabase/supabase-js`/`@bokpoints/shared`; dev deps vite, plugin, typescript,
`@types/react`, `@types/react-dom`. `pnpm dev` at the root now starts API and
web together (`-r --parallel`).

## Task 4 — web pure logic (tests first)

Files: `apps/web/src/format.ts` (`parseAmountToCents`, `normalizeScan`,
`formatDate`), `apps/web/src/errors.ts` (`cashierMessage(code)`), tests
`apps/web/test/unit/format.test.ts`, `apps/web/test/unit/errors.test.ts`.

`parseAmountToCents`: `'12,50'|'12.50' → 1250`, `'12' → 1200`, `'0.5' → 50`,
`''|'abc'|'12.345'|'-1' → null`. `normalizeScan`: trims whitespace/CR/tab and
keeps the case (the server matches identifiers exactly). `cashierMessage`: known
API codes → plain sentences, unknown → generic sentence containing the code.

## Task 5 — web app

Files: `apps/web/src/{auth.ts,api.ts,App.tsx,Login.tsx,MfaSetup.tsx,StorePicker.tsx,Till.tsx}`,
`main.tsx` wiring, PWA registration.

- `auth.ts`: supabase client from `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_PUBLISHABLE_KEY`; `signIn`, `enrolTotp`, `verifyTotp`,
  `signOut`, `onAuthChange`, `accessToken()`, `aalOf()`.
- `api.ts`: `getMe`, `identify(storeId, code)` (app_qr then nfc_card),
  `preview(storeId, body)`, `award(storeId, body)` with a fresh
  `Idempotency-Key`; typed `ApiError { status, code, message }`.
- `App.tsx`: no session → `Login`; session but `aal1` → code step (`MfaSetup`
  when no factor); `aal2` → store resolve (`GET /v1/me`) → `Till`.
- `Till.tsx`: scan input (autofocus, Enter submits, refocus after every
  action) → customer card (first name, balance, branch) → amount field with
  300 ms debounced preview → confirm (award) → result with new balance and
  expiry → next customer. Errors via `cashierMessage`.
- PWA: manifest (name, start_url, display standalone, svg icon), minimal
  service worker, registered in `main.tsx`.

Verify: `pnpm typecheck`, `pnpm lint`, `pnpm --filter @bokpoints/web build`,
`pnpm test`.

## Task 6 — live run + docs

- Reset the demo cashier's MFA factor (Supabase admin API) so the first web
  sign-in shows the set-up step; hand the user the `otpauth://` URI.
- `pnpm dev` (API + web), sign in on `http://localhost:5173`, enrol, scan
  `CUST-QR-0001`, award on Kahvila Bea, show the new balance.
- Docs: DECISIONS D-109 (me + preview, preview writes nothing), D-110 (screen:
  wedge scanner, persisted session, English strings, proxy-not-CORS, PWA shell);
  HANDOFF Build 7 row; STATUS Done/Next/Last-updated; RUNBOOK (web URL, dev
  command now starts both, demo accounts).
- Commit, push, watch CI.
