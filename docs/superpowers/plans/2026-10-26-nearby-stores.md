# Nearby Stores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The customer app asks for location permission once, then the Stores tab lists active businesses nearest to the customer, re-sorted whenever the app refreshes — so moving cities or travelling keeps the list current.

**Architecture:** The browser/mobile Geolocation API resolves the customer's coordinates on the client; coordinates are never stored server-side. Each directory response is sorted by haversine distance in the API using the store's address-derived coordinates (cached at geocode time by the owner's profile save) or a fallback. Denied/absent location degrades to the current alphabetical list.

**Tech Stack:** Expo/react-native-web Geolocation (via `navigator.geolocation` on web, `expo-location` on native is NOT added — the pilot is web-first), plain haversine in TypeScript, Postgres columns `stores.latitude`/`stores.longitude` (nullable doubles).

**Spec:** A's direction of 26 Oct 2026 (this session): "It just allows location, and the nearby stores are listed and sync to the mobile app. No result is fine."

## Global Constraints
- Never store customer coordinates in the database; distance sorting is request-scoped.
- Location is permission-gated: no popup on app start, only from the Stores tab.
- Denied permission or no stores nearby must both render a useful screen, never a blank one.
- No new runtime dependencies in the customer app; use `navigator.geolocation` (Expo web maps it; on native it is absent — degrade).
- Keep the existing alphabetical fallback order when location is unavailable.
- API never returns coordinates; only `distanceKm` (one decimal) per store when the request carries a location.

## Review Focus
- Permission denied → tab must still list stores alphabetically, with a one-line "show nearby" affordance.
- Customer has no stores joined → tab must still show the nearby directory (discovery is the point).
- Store has no coordinates (never geocoded) → it must not crash sorting; it lands in the list without a distance label.
- Refresh after travel → the next directory fetch re-sorts; no background watcher, no continuous tracking.
- API abuse: the sort is per-request but bounded by the directory row count (already rate-limited).

---

### Task 1: Store coordinates on the schema (migration 0019)

**Files:**
- Modify: `apps/api/src/db/schema.ts` (stores table, after `address`)
- Create: `apps/api/src/db/migrations/0019_<generated>.sql` (via drizzle-kit)
- Test: existing `apps/api/test/integration/schema.test.ts` pattern is enough (migration journal test covers consistency)

**Interfaces:**
- Produces: `stores.latitude: number | null`, `stores.longitude: number | null` for later tasks.

- [ ] **Step 1: Add nullable columns to the stores table in `apps/api/src/db/schema.ts`**

```ts
/** Approximate point for "nearby" sorting. Set when the owner's address is
 *  geocoded; null keeps the store in the list without a distance. */
latitude: doublePrecision('latitude'),
longitude: doublePrecision('longitude'),
```

(Import `doublePrecision` from `drizzle-orm/pg-core`.)

- [ ] **Step 2: Generate migration 0019**

Run: `pnpm --filter @bokpoints/api db:generate`
Expected: new SQL file with two `ALTER TABLE "stores" ADD COLUMN ... double precision` statements; journal updated.

- [ ] **Step 3: Apply to the test database via the suite and to production manually**

Run: `pnpm vitest run --project integration apps/api/test/integration/schema.test.ts`
Expected: PASS (suite applies migrations).
Then apply to hosted Supabase with the same `DATABASE_URL="$SUPABASE_DB_URL?sslmode=no-verify"` technique used for migration 0018.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations
git commit -m "feat: store coordinates for nearby sorting"
```

### Task 2: Geocode the owner's address when the profile is saved

**Files:**
- Create: `apps/api/src/lib/geocode.ts`
- Modify: `apps/api/src/routes/stores.ts` (profile PATCH handler, ~line 1060)
- Test: `apps/api/test/integration/store-nearby.test.ts`

**Interfaces:**
- Produces: `geocodeAddress(address: string): Promise<{ latitude: number; longitude: number } | null>` — returns null on any failure (no key, network, no result). Never throws.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/integration/store-nearby.test.ts
it('stores coordinates when the owner saves an address', async () => {
  // owner saves profile with address 'Mannerheimintie 10, Helsinki'
  // assert stores row has non-null latitude/longitude
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/api/test/integration/store-nearby.test.ts`
Expected: FAIL — columns are null because nothing geocodes yet.

- [ ] **Step 3: Implement `geocode.ts`**

Use OpenStreetMap Nominatim (`https://nominatim.openstreetmap.org/search?q=...&format=json&limit=1`, User-Agent `OmaPointii-pilot/0.1`), `AbortSignal.timeout(4000)`, return null on any failure. Cache is the DB column itself (only geocode when the address changed). Optional env `GEOCODE_ENABLED` (default on).

- [ ] **Step 4: Wire into the profile PATCH**

After the transaction commits, if `body.address` was provided and changed, call `geocodeAddress` and update the row's coordinates (separate small update, failures ignored).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run apps/api/test/integration/store-nearby.test.ts`
Expected: PASS (geocode is injectable — tests pass a fake that returns Helsinki coordinates).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: geocode the store address for nearby sorting"
```

### Task 3: Directory returns distance when the request carries a location

**Files:**
- Modify: `packages/shared/src/schemas.ts` (`directoryStoreSchema`, `directoryResponseSchema`, add `directoryQuerySchema`)
- Modify: `apps/api/src/routes/customer.ts` (`/v1/customer/stores`, line ~359)
- Modify: `apps/customer/src/lib/api.ts` (`getDirectory`)
- Test: `apps/api/test/integration/store-nearby.test.ts`

**Interfaces:**
- Consumes: Task 2's coordinates on `stores`.
- Produces: `GET /v1/customer/stores?lat=60.17&lon=24.94` → `{ stores: [{ ...existing, distanceKm: number | null }] }`, sorted by distance ascending, null-distance last (alphabetical within). Without `lat`/`lon`: current behaviour exactly.

- [ ] **Step 1: Write the failing test**

```ts
it('sorts the directory by distance when the caller sends coordinates', async () => {
  // two active stores, one 'near' with (60.17, 24.94), one 'far' with (60.5, 25.0)
  // GET /v1/customer/stores?lat=60.17&lon=24.94
  // expect first store name 'Near Store', distanceKm < 1, second has distanceKm > 20
});
it('keeps alphabetical order without coordinates', async () => {
  // GET /v1/customer/stores → order is alphabetical, distanceKm null
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/api/test/integration/store-nearby.test.ts`
Expected: FAIL — no `distanceKm` in the response.

- [ ] **Step 3: Implement**

Add to `directoryStoreSchema`: `distanceKm: z.number().min(0).nullable()`. Add `directoryQuerySchema = z.object({ lat: z.coerce.number().min(-90).max(90).optional(), lon: z.coerce.number().min(-180).max(180).optional() })`. In the route, compute the haversine in SQL (Postgres has no built-in; do it in TypeScript after the existing query) and sort. `lat` without `lon` (or vice versa) → ignore both.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/api/test/integration/store-nearby.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: nearby directory sorted by distance"
```

### Task 4: Customer Stores tab asks for location and renders nearby

**Files:**
- Create: `apps/customer/src/lib/location.ts`
- Modify: `apps/customer/src/screens/Stores.tsx`
- Test: `apps/customer/test/unit/location.test.ts` (follow the existing `apps/web/test/unit` pattern; create the dir)

**Interfaces:**
- Consumes: Task 3's `getDirectory(token, { lat, lon })` and `distanceKm` on `DirectoryStore`.
- Produces: `requestLocation(): Promise<{ lat: number; lon: number } | null>` — resolves null on denial/timeout/unavailability; never throws.

- [ ] **Step 1: Write the failing test**

```ts
// apps/customer/test/unit/location.test.ts
it('returns coordinates when permission is granted', async () => {
  const result = await requestLocation({ geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 60.17, longitude: 24.94 } }) } });
  expect(result).toEqual({ lat: 60.17, lon: 24.94 });
});
it('resolves null when the customer refuses', async () => {
  const result = await requestLocation({ geolocation: { getCurrentPosition: (_ok, fail) => fail(new Error('denied')) } });
  expect(result).toBeNull();
});
it('resolves null when geolocation is unavailable (native app)', async () => {
  expect(await requestLocation(undefined)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/customer/test/unit/location.test.ts`
Expected: FAIL — `requestLocation` not defined.

- [ ] **Step 3: Implement `location.ts`**

Wrap `navigator.geolocation.getCurrentPosition` with `{ enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 }`. Never throw. On native (no `navigator.geolocation`), resolve null.

- [ ] **Step 4: Update the Stores screen**

On mount: fetch the directory without location (current behaviour) so the list is never empty. Then `requestLocation()`; if it returns coordinates, re-fetch with them and store a `located: { lat, lon } | null` state. Render:
- located → subtitle "Near you · <city or 'these businesses'>" with `distanceKm` chips ("2.3 km") on each row; re-run on every `onRefresh` (pull-to-refresh) so travel re-sorts.
- denied/unavailable → current list, plus a muted line: "Turn on location to see businesses near you." Tapping it calls `requestLocation()` again.

- [ ] **Step 5: Run test to verify it passes and the app typechecks**

Run: `pnpm vitest run apps/customer/test/unit/location.test.ts && pnpm --filter @bokpoints/customer typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: nearby stores in the customer app"
```

### Task 5: Deploy and record

**Files:**
- Modify: `docs/DECISIONS.md` (new D-167 row)
- Modify: `handoff/STATUS.md` (Done bullet)

- [ ] **Step 1: Full verification**

Run: `pnpm lint && pnpm typecheck && pnpm vitest run --project unit --project integration && pnpm build`
Expected: all clean, 408+ tests pass.

- [ ] **Step 2: Apply migration 0019 to hosted Supabase**

Same command pattern as migration 0018 (`DATABASE_URL="$SUPABASE_DB_URL?sslmode=no-verify" pnpm --filter @bokpoints/api db:migrate`).

- [ ] **Step 3: Commit docs, push, verify API deploy, redeploy the customer app**

```bash
git commit -m "feat: nearby stores with location permission (D-167)"
git push origin main
```
Then: poll `https://api.omapointii.store/v1/health` for the new commit; rebuild/deploy `apps/customer/dist` to Vercel as before.

- [ ] **Step 4: Record the decision**

`D-167`: nearby discovery uses one-time location permission; coordinates never stored; "no result" screens are first-class; a real map is explicitly out of scope for the pilot.

---

## Self-Review
- Spec coverage: permission popup (Task 4), list+sync on travel (Task 3 sort + Task 4 re-fetch on refresh), "no result is fine" (Task 4 empty state), coordinates on stores (Tasks 1-2).
- Step scan: every step names one file/test/command; no "handle edge cases" placeholders.
- Type consistency: `distanceKm` (Task 3) matches Task 4's `DirectoryStore`; `requestLocation` shape matches Task 3's query params.
- Review Focus: denial, empty result, un-geocoded store, travel refresh, abuse bound — each has a test or an explicit degradation in Tasks 2-4.
- Proportion: five tasks against a feature that touches schema, one API route, one shared schema and one screen.
