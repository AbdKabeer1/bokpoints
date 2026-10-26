# Overpass Nearby Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** The customer Stores tab lists every nearby business within 10 km — registered OmaPointii stores and unregistered businesses from OpenStreetMap — sorted by distance and filterable by category.

**Architecture:** A new authenticated API endpoint `/v1/customer/discover` queries the public Overpass API for named amenities and shops around the customer's coordinates, maps them to a small place shape, caches the result for five minutes and returns it. The customer app merges those places with the existing OmaPointii directory, de-duplicates by name, and renders one distance-sorted list. Registered stores keep points and are tappable; unregistered places are display-only for v1.

**Tech Stack:** Fastify + Drizzle API, shared zod schemas, Expo web customer app, Overpass API (`https://overpass-api.de/api/interpreter`).

**Spec:** A's direction of 27 Oct 2026: "All enterprises in the nearest vicinity should show — 10–20 km away if that's realistic." OSM Overpass chosen over Google Places for the pilot (free, no key, good Helsinki coverage).

## Global Constraints
- Radius default **10 km**, maximum **20 km**.
- Only named places (`name` tag present) are returned.
- Limit **120** places per response.
- Never return more than the radius allows; distance is haversine, one decimal.
- Overpass failure is not a customer-visible error: return `places: []`, `available: false`; the app keeps showing OmaPointii stores.
- Cache key: rounded coordinates to 3 decimals + radius; TTL 5 minutes.
- Attribution `© OpenStreetMap contributors` is returned and rendered.
- Unregistered places are display-only in v1 (no navigation, no invite action).
- No customer coordinates are stored.

## Review Focus
- Overpass returns a place without `name` → dropped, never rendered as blank.
- Overpass times out → directory still renders, no error screen.
- A registered store also appears in Overpass → not duplicated.
- Customer denies location → no discovery call, alphabetical directory plus the existing location button.
- Category chips show only categories present in the merged list.

---

### Task 1: Overpass client and mapping

**Files:**
- Create: `apps/api/src/lib/overpass.ts`
- Test: `apps/api/test/unit/overpass.test.ts`

**Interfaces:**
- Produces: `discoverNearby(input: { lat: number; lon: number; radiusKm: number }, fetchImpl?: typeof fetch): Promise<NearbyPlace[]>`
- Produces: `NearbyPlace = { osmId: string; name: string; category: string; address: string | null; distanceKm: number }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { discoverNearby } from '../../src/lib/overpass';

it('maps named OSM places to categories and distance', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      elements: [
        {
          type: 'node',
          id: 1,
          lat: 60.17,
          lon: 24.94,
          tags: { name: 'Cafe Test', amenity: 'cafe', 'addr:street': 'Testikatu', 'addr:housenumber': '1' },
        },
        {
          type: 'node',
          id: 2,
          lat: 60.2,
          lon: 24.95,
          tags: { amenity: 'restaurant' },
        },
      ],
    }),
  }) as unknown as Response;

  const places = await discoverNearby(
    { lat: 60.168, lon: 24.942, radiusKm: 10 },
    fakeFetch,
  );

  expect(places).toHaveLength(1);
  expect(places[0]).toMatchObject({
    name: 'Cafe Test',
    category: 'Cafe',
    address: 'Testikatu 1',
  });
  expect(places[0]?.distanceKm).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/api/test/unit/overpass.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `discoverNearby`**

Build the Overpass query with `nwr["name"]["amenity"~"^(restaurant|cafe|bar|pub|fast_food|pharmacy|bank|cinema|theatre|nightclub|ice_cream|dentist|doctors|veterinary|fuel)$"](around:<metres>,<lat>,<lon>);` plus `nwr["name"]["shop"](around:...)`; `out center 120;`.
Use `AbortSignal.timeout(8000)`.
Map categories from `amenity` then `shop` (title-case the shop value), `tourism=hotel` → Hotel, `leisure=fitness_centre` → Gym.
Address from `addr:street` + `addr:housenumber`, fallback `addr:city`, else null.
Drop unnamed places. Sort by distance. Return at most 120.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/api/test/unit/overpass.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/overpass.ts apps/api/test/unit/overpass.test.ts
git commit -m "feat: Overpass nearby discovery client"
```

### Task 2: Discovery endpoint

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `apps/api/src/routes/customer.ts`
- Test: `apps/api/test/integration/discover.test.ts`

**Interfaces:**
- Consumes: Task 1 `discoverNearby`.
- Produces: `GET /v1/customer/discover?lat=&lon=&radiusKm=` → `{ places: NearbyPlace[], available: boolean, attribution: string }`.

- [ ] **Step 1: Write the failing test**

```ts
it('returns nearby OSM places for a customer with coordinates', async () => {
  // build app with a fake discoverNearby injected into route options
  // GET /v1/customer/discover?lat=60.17&lon=24.94&radiusKm=10
  // expect 200, places[0].name 'Cafe Test', available true
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/api/test/integration/discover.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Add schemas and route**

`discoverQuerySchema`: lat -90..90, lon -180..180, radiusKm 1..20 default 10.
`nearbyPlaceSchema`, `discoverResponseSchema`.
Route uses the existing customer resolver/provision flow; rate limit 20/min; calls `discoverNearby`; catches errors and returns empty array with `available:false`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/api/test/integration/discover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts apps/api/src/routes/customer.ts apps/api/test/integration/discover.test.ts
git commit -m "feat: nearby discovery endpoint"
```

### Task 3: Customer app merge and category filter

**Files:**
- Modify: `apps/customer/src/lib/api.ts`
- Modify: `apps/customer/src/screens/Home.tsx`
- Modify: `apps/customer/src/screens/Stores.tsx`
- Test: `apps/customer/test/unit/discover-merge.test.ts`

**Interfaces:**
- Consumes: Task 2 endpoint.
- Produces: `NearbyPlace` type and `discoverNearby(token, lat, lon, radiusKm)`.
- Produces: `mergePlaces(directory, nearby)` pure function returning a unified list.

- [ ] **Step 1: Write the failing test**

```ts
it('merges registered and unregistered places without duplicating names', () => {
  const merged = mergePlaces(
    [{ storeId: 's1', name: 'Cafe Test', category: 'Cafe', distanceKm: 0.1 }],
    [{ osmId: 'n1', name: 'Cafe Test', category: 'Cafe', distanceKm: 0.1 }],
  );
  expect(merged).toHaveLength(1);
  expect(merged[0]?.registered).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/customer/test/unit/discover-merge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement merge and UI**

`mergePlaces` normalises names (`trim().toLowerCase()`); a registered store wins and is marked `registered: true`; unregistered places get `registered: false`.
Home: after location resolves, call `getDirectory` and `discoverNearby` in parallel; store `nearby`; pass merged list to Stores.
Stores: render one distance-sorted list. Registered rows keep points and tap; unregistered rows show `Not on OmaPointii` and are not tappable. Category chips use merged categories. Show `© OpenStreetMap contributors` at the bottom when discovery is available.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/customer/test/unit/discover-merge.test.ts && pnpm --filter @bokpoints/customer typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src apps/customer/test/unit/discover-merge.test.ts
git commit -m "feat: merge OSM nearby places into the Stores tab"
```

### Task 4: Deploy and record

- [ ] Run `pnpm lint && pnpm typecheck && pnpm vitest run --project unit --project integration`.
- [ ] Push; wait for Render to serve the new commit at `/v1/health`.
- [ ] Rebuild the customer app with `EXPO_PUBLIC_API_BASE=https://api.omapointii.store` and deploy to `poket-app`.
- [ ] Add D-169 to `docs/DECISIONS.md` and a handoff bullet.
EOF
