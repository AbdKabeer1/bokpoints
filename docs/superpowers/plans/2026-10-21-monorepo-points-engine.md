# BOKPOINTS Monorepo + Points Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the BOKPOINTS pnpm monorepo with CI, build the pure points engine in `packages/shared` with full unit tests, and define the Drizzle/Postgres ledger schema with migrations and the transactional ledger write path.

**Architecture:** `packages/shared` holds all business logic as pure, dependency-free functions (points calculation, expiry, FIFO, balance, permissions) so the API and the future offline Cashier PWA share identical code. `apps/api` is a Fastify service that owns all database access. Points maths uses integers only (cents and whole points); `pointsPerEuro` is stored in thousandths so no floating point ever touches money or points.

**Tech Stack:** pnpm 12.9.1 workspace, TypeScript 6.0.3 (strict), Vitest 4.1.12, Fastify 5.12.7, Drizzle ORM 0.45.4 + drizzle-kit 0.31.11, PostgreSQL 17 (Homebrew `postgresql@17`, local `bokpoints_dev` / `bokpoints_test` databases), Zod 4.6.7, ESLint 10.13.0 + typescript-eslint 8.72.0, Prettier 3.9.10, GitHub Actions.

**Spec:** `docs/PRD.md` (PRD v0.2), `docs/FRD.md` (FRD v0.2), `AGENT.md` (v0.1), `docs/DECISIONS.md`, `docs/HANDOFF.md`. PDFs of the PRD/FRD live in `docs/source/`.

## Global Constraints

These come from `AGENT.md` and the FRD. Every task inherits them.

- **TypeScript strict mode everywhere.** No `any` without a comment explaining why. Prefer `unknown` and narrow.
- **Money is whole cents in euros. Points are whole numbers.** No floating point in money or points maths anywhere. Default rounding is round down.
- **`pointsPerEuro` is an integer in thousandths.** `1000` means 1 point per euro.
- **Business logic lives in `packages/shared` as pure functions with no I/O.** The API and the offline Cashier screen must use the same code for points calculation so they cannot disagree.
- **The ledger is append-only.** Entries are never updated or deleted. Enforce in the database, not only in application code.
- **No reversals.** There is no undo or reverse feature. Mistakes are fixed by an `adjust` entry with a required reason.
- **A balance never goes below zero, except through an admin-only `fraud_clawback`.**
- **Points expire 3 months after the day they were earned.** Oldest points are used first (FIFO).
- **Every award request carries an idempotency key.** Retrying must never award twice.
- **The ledger entry and the balance update happen in one database transaction.** If either fails, neither is saved.
- **Store isolation is enforced on the server, in every query.** A store can only see its own customers' data.
- **Server-side authorization.** Every endpoint checks the role and the store. Hiding a button in the UI is never access control.
- **No secrets in the repo, in client bundles or in logs.** Provide `.env.example` with names only. `.env` is gitignored.
- **Names:** `camelCase` variables and functions, `PascalCase` types and components, `kebab-case` files. Money fields end in `Cents`.
- **Comments explain why, not what.** Reference FRD IDs for non-obvious rules.
- **Commit messages:** imperative, short, with the FRD ID when relevant, e.g. `Add earn-points calculation (FR-PTS-1, FR-PTS-4)`.
- **Never use `--no-verify`, never force-push to `main`, never disable a test, a lint rule or a type check.**
- **Pin exact dependency versions and commit the lockfile.**
- **When you add or change a script, update `AGENT.md` section 5 in the same change.**
- **Phase is MVP.** Do not build v1.1 or v2 features (redemption, products, discounts, campaigns, push, NFC card, wallet passes, POS, gifting, gift cards, SMS).
- **Database changes only through Drizzle migrations.** Never edit a migration that has been applied.

## Review Focus

The five input classes the spec implies that no single task's tests obviously cover. Each line gets a test in the owning task, in that task's own step style.

1. **Amount of zero, or a negative amount.** A cashier can type `0` or a stray `-`. The award must award zero points, never a negative ledger entry, and never create a balance row that goes below zero.
2. **The minimum-purchase boundary is exactly equal.** `amountCents === minPurchaseCents` must award points, not zero — the rule is "below the minimum", not "at or below".
3. **Expiry across a short month.** Points earned on 31 January must expire on 30 April, not 3 March and not 2 April. The expiry month clamp has to be pinned by a test.
4. **FIFO with batches that expire on the same date.** Two batches earned the same day must be consumed in a deterministic order, and the second batch's `remainingPoints` must be updated correctly.
5. **Idempotency key reuse across different stores.** The same key used at Store A and then at Store B must not silently dedupe against Store A's entry — the dedupe scope must be explicit and tested.

---

## File Structure

```
bokpoints/
├── .github/workflows/ci.yml              # CI: typecheck, lint, unit, integration
├── .env.example                          # names only, no values
├── .gitignore                            # .env, node_modules, dist, coverage
├── .prettierrc.json
├── eslint.config.js                      # flat config, imports @bokpoints/config
├── package.json                          # root, private, workspace scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── AGENT.md                              # updated: section 5 commands now real
├── apps/
│   ├── api/
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── app.ts                   # Fastify instance factory
│   │   │   ├── server.ts                # entrypoint, listens on PORT
│   │   │   ├── env.ts                   # Zod-validated process env
│   │   │   └── db/
│   │   │       ├── client.ts            # pg Pool + Drizzle instance
│   │   │       ├── schema.ts            # all Drizzle tables + constraints
│   │   │       └── ledger.ts            # transactional ledger write path
│   │   └── test/
│   │       ├── unit/app.test.ts
│   │       └── integration/ledger.test.ts
│   ├── customer/                        # stub: Expo app, build order step 5
│   └── web/                             # stub: React+Vite PWA, build order step 4
├── packages/
│   ├── config/
│   │   ├── eslint.config.js
│   │   ├── package.json
│   │   ├── prettier.config.js
│   │   └── tsconfig.base.json
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                 # public barrel
│           ├── permissions.ts           # role/capability matrix (FRD §2)
│           ├── schemas.ts               # Zod schemas for rule + inputs
│           └── points/
│               ├── balance.ts           # balance + adjustment invariants
│               ├── calculate.ts         # FR-PTS-1/2/3
│               ├── expiry.ts            # FR-PTS-10
│               ├── fifo.ts              # oldest-first consumption
│               └── types.ts             # shared types
└── docs/
    ├── DECISIONS.md                     # new rows appended
    ├── FRD.md                           # exported from PDF
    ├── HANDOFF.md                       # updated
    ├── PRD.md                           # exported from PDF
    ├── source/                          # source PDFs + extracted text
    └── superpowers/plans/               # this plan
```

**Responsibility rule:** `packages/shared/src/points/*` never imports from `apps/*`. `apps/api/src/db/schema.ts` holds table definitions only; `apps/api/src/db/ledger.ts` holds write logic. Nothing in `packages/shared` imports from `apps/api`.

---

### Task 1: Monorepo skeleton, tooling and CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`, `.env.example`, `.github/workflows/ci.yml`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/eslint.config.js`, `packages/config/prettier.config.js`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/README.md`
- Create: `apps/customer/package.json`, `apps/customer/tsconfig.json`, `apps/customer/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace `@bokpoints/shared`, `@bokpoints/config`, `@bokpoints/api`, `@bokpoints/web`, `@bokpoints/customer` package names; root scripts `dev`, `typecheck`, `lint`, `test`, `test:integration`, `db:generate`, `db:migrate`; `@bokpoints/config` exports `eslint.config.js` and `tsconfig.base.json` consumed via package exports.

- [ ] **Step 1: Create the workspace root**

`package.json`:
```json
{
  "name": "bokpoints",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.9.1",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "typecheck": "pnpm -r --parallel typecheck",
    "lint": "eslint .",
    "test": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "db:generate": "pnpm --filter @bokpoints/api db:generate",
    "db:migrate": "pnpm --filter @bokpoints/api db:migrate"
  },
  "devDependencies": {
    "@types/node": "25.9.9",
    "eslint": "10.13.0",
    "prettier": "3.9.10",
    "typescript": "6.0.3",
    "typescript-eslint": "8.72.0",
    "vitest": "4.1.12"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

- [ ] **Step 2: Create the shared config package**

`packages/config/package.json` declares `"name": "@bokpoints/config"` and exports `./eslint.config.js` and `./tsconfig.base.json`.

`packages/config/tsconfig.base.json` sets `strict: true`, `target: "ES2023"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `isolatedModules: true`, `verbatimModuleSyntax: true`, `skipLibCheck: true`, `declaration: true`, `sourceMap: true`.

- [ ] **Step 3: Create the root `tsconfig.base.json` extending the config package**

```json
{ "extends": "@bokpoints/config/tsconfig.base.json" }
```

- [ ] **Step 4: Create `.gitignore`**

Must contain `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.local`, `*.tsbuildinfo`, `.DS_Store`, `playwright-report/`, `test-results/`.

- [ ] **Step 5: Create `.env.example`**

Names only, no values: `DATABASE_URL`, `PORT`, `HOST`, `LOG_LEVEL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SENTRY_DSN`, `EMAIL_API_KEY`, `EMAIL_FROM`.

- [ ] **Step 6: Create the ESLint flat config and Prettier config**

`eslint.config.js` imports `@bokpoints/config/eslint.config.js` and adds ignores for `dist`, `node_modules`, `coverage`, `drizzle/meta`.

- [ ] **Step 7: Create the app package stubs**

`apps/api/package.json`:
```json
{
  "name": "@bokpoints/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -b",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@bokpoints/shared": "workspace:*",
    "drizzle-orm": "0.45.4",
    "fastify": "5.12.7",
    "pg": "8.23.1",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@types/pg": "8.15.6",
    "drizzle-kit": "0.31.11",
    "tsx": "4.23.15",
    "typescript": "6.0.3"
  }
}
```

`apps/web/package.json` and `apps/customer/package.json` are stubs with `name`, `private: true`, `type: "module"`, a `typecheck` script, and a README stating the build-order step that will implement them. They must not depend on packages that are not installed yet, so `pnpm install` stays clean.

- [ ] **Step 8: Install dependencies**

Run: `pnpm install`
Expected: lockfile created, no peer-dependency errors.

- [ ] **Step 9: Verify the workspace resolves**

Run: `pnpm -r list --depth -1`
Expected: five workspace packages listed: `@bokpoints/api`, `@bokpoints/customer`, `@bokpoints/web`, `@bokpoints/config`, `@bokpoints/shared`.

- [ ] **Step 10: Create the GitHub Actions workflow**

`.github/workflows/ci.yml` runs on `push` and `pull_request` against `ubuntu-latest`, with a `postgres:17` service container exposing 5432 and a `--health-cmd pg_isready` check. Steps: checkout, `pnpm/action-setup` with version from `packageManager`, `actions/setup-node` with `node-version: 24` and `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration` with `DATABASE_URL=postgres://postgres:postgres@localhost:5432/bokpoints_test`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Set up pnpm monorepo skeleton, tooling and CI"
```

---

### Task 2: Points engine in `packages/shared`

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/points/types.ts`
- Create: `packages/shared/src/points/calculate.ts`
- Create: `packages/shared/src/points/expiry.ts`
- Create: `packages/shared/src/points/fifo.ts`
- Create: `packages/shared/src/points/balance.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/points/calculate.test.ts`, `expiry.test.ts`, `fifo.test.ts`, `balance.test.ts`

**Interfaces:**
- Consumes: `@bokpoints/config` (tsconfig).
- Produces, all exported from `@bokpoints/shared`:
  - `type RoundingMode = 'floor' | 'nearest'`
  - `type PointsRejectionReason = 'below_minimum'`
  - `interface PointsRule { pointsPerEuroThousandths: number; minPurchaseCents?: number; maxPointsPerTransaction?: number; rounding?: RoundingMode }`
  - `interface PointsCalculation { points: number; uncappedPoints: number; capped: boolean; awarded: boolean; reason?: PointsRejectionReason }`
  - `calculatePoints(amountCents: number, rule: PointsRule): PointsCalculation`
  - `expiryDateForEarn(earnedAt: Date): Date`
  - `interface PointsBatch { entryId: string; points: number; remainingPoints: number; expiresAt?: Date }`
  - `interface ConsumedBatch { entryId: string; points: number }`
  - `consumePointsFIFO(batches: PointsBatch[], amount: number): { consumed: ConsumedBatch[]; shortfall: number }`
  - `type LedgerEntryType = 'earn' | 'redeem' | 'adjust' | 'expire' | 'fraud_clawback'`
  - `interface LedgerEntry { type: LedgerEntryType; points: number }`
  - `balanceFromEntries(entries: LedgerEntry[]): number`
  - `type PointsErrorCode = 'BALANCE_WOULD_GO_NEGATIVE' | 'INSUFFICIENT_POINTS' | 'INVALID_AMOUNT'`
  - `interface PointsError { code: PointsErrorCode; message: string }`
  - `adjustPoints(balance: number, points: number): { ok: true; balance: number } | { ok: false; error: PointsError }`
  - `applyFraudClawback(balance: number, points: number): { ok: true; balance: number } | { ok: false; error: PointsError }`

- [ ] **Step 1: Create the package and its tsconfig**

`packages/shared/package.json`:
```json
{
  "name": "@bokpoints/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": { "typecheck": "tsc --noEmit", "build": "tsc -b" },
  "dependencies": { "zod": "4.6.7" },
  "devDependencies": { "typescript": "6.0.3" }
}
```

- [ ] **Step 2: Write the failing test for `calculatePoints`**

`packages/shared/src/points/calculate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { calculatePoints } from './calculate';

const onePerEuro = { pointsPerEuroThousandths: 1000 };

describe('calculatePoints', () => {
  it('awards 23 points for 23.80 euros at 1 point per euro', () => {
    // FR-PTS-1 worked example: 1 point per euro, 23.80 euros -> 23 points
    expect(calculatePoints(2380, onePerEuro).points).toBe(23);
  });

  it('rounds down by default', () => {
    expect(calculatePoints(199, onePerEuro).points).toBe(1);
  });

  it('awards zero for a zero amount', () => {
    expect(calculatePoints(0, onePerEuro).points).toBe(0);
  });

  it('refuses an amount below the minimum purchase', () => {
    const r = calculatePoints(999, { ...onePerEuro, minPurchaseCents: 1000 });
    expect(r.awarded).toBe(false);
    expect(r.reason).toBe('below_minimum');
    expect(r.points).toBe(0);
  });

  it('awards points when the amount equals the minimum purchase exactly', () => {
    const r = calculatePoints(1000, { ...onePerEuro, minPurchaseCents: 1000 });
    expect(r.awarded).toBe(true);
    expect(r.points).toBe(10);
  });

  it('caps at the maximum points per transaction', () => {
    const r = calculatePoints(10000, { ...onePerEuro, maxPointsPerTransaction: 50 });
    expect(r.points).toBe(50);
    expect(r.uncappedPoints).toBe(100);
    expect(r.capped).toBe(true);
  });

  it('supports fractional earn rates in thousandths', () => {
    expect(calculatePoints(2380, { pointsPerEuroThousandths: 1500 }).points).toBe(35);
  });

  it('rounds to nearest when the rule asks for it', () => {
    expect(calculatePoints(2380, { ...onePerEuro, rounding: 'nearest' }).points).toBe(24);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @bokpoints/shared exec vitest run src/points/calculate.test.ts`
Expected: FAIL — cannot resolve `./calculate`.

- [ ] **Step 4: Implement `calculatePoints`**

`packages/shared/src/points/types.ts` holds `RoundingMode`, `PointsRejectionReason`, `PointsRule`, `PointsCalculation`.

`packages/shared/src/points/calculate.ts`:
```ts
import type { PointsCalculation, PointsRule } from './types';

/**
 * points = floor(amountCents * pointsPerEuroThousandths / 100_000)
 *
 * Integer maths only. 100_000 = 100 cents per euro * 1000 thousandths per point.
 * FR-PTS-1
 */
const SCALE = 100_000;

export function calculatePoints(amountCents: number, rule: PointsRule): PointsCalculation {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError('amountCents must be a non-negative integer');
  }
  if (rule.minPurchaseCents !== undefined && amountCents < rule.minPurchaseCents) {
    return { points: 0, uncappedPoints: 0, capped: false, awarded: false, reason: 'below_minimum' };
  }
  const scaled = amountCents * rule.pointsPerEuroThousandths;
  const raw =
    rule.rounding === 'nearest'
      ? Math.floor((scaled + SCALE / 2) / SCALE)
      : Math.floor(scaled / SCALE);
  const capped = rule.maxPointsPerTransaction !== undefined && raw > rule.maxPointsPerTransaction;
  const points = capped ? rule.maxPointsPerTransaction! : raw;
  return { points, uncappedPoints: raw, capped, awarded: true };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @bokpoints/shared exec vitest run src/points/calculate.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Write the failing test for `expiryDateForEarn`**

`packages/shared/src/points/expiry.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { expiryDateForEarn } from './expiry';

describe('expiryDateForEarn', () => {
  it('expires 2 June points on 2 September (AC-6)', () => {
    expect(expiryDateForEarn(new Date('2026-06-02T10:30:00Z')).toISOString()).toBe(
      '2026-09-02T00:00:00.000Z',
    );
  });

  it('clamps to the last day of a shorter month (31 January -> 30 April)', () => {
    expect(expiryDateForEarn(new Date('2026-01-31T12:00:00Z')).toISOString()).toBe(
      '2026-04-30T00:00:00.000Z',
    );
  });

  it('crosses the year boundary (15 November -> 15 February)', () => {
    expect(expiryDateForEarn(new Date('2026-11-15T00:00:00Z')).toISOString()).toBe(
      '2027-02-15T00:00:00.000Z',
    );
  });

  it('ignores the time of day and returns UTC midnight', () => {
    expect(expiryDateForEarn(new Date('2026-06-02T23:59:59Z')).toISOString()).toBe(
      '2026-09-02T00:00:00.000Z',
    );
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter @bokpoints/shared exec vitest run src/points/expiry.test.ts`
Expected: FAIL — cannot resolve `./expiry`.

- [ ] **Step 8: Implement `expiryDateForEarn`**

`packages/shared/src/points/expiry.ts`:
```ts
const EXPIRY_MONTHS = 3;

/**
 * Points expire 3 months after the day they were earned (FR-PTS-10, AC-6).
 * If the target month is shorter than the earn day, clamp to that month's
 * last day: 31 January + 3 months -> 30 April.
 */
export function expiryDateForEarn(earnedAt: Date): Date {
  const year = earnedAt.getUTCFullYear();
  const month = earnedAt.getUTCMonth();
  const day = earnedAt.getUTCDate();

  const targetMonthStart = new Date(Date.UTC(year, month + EXPIRY_MONTHS, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();

  const result = new Date(targetMonthStart);
  result.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @bokpoints/shared exec vitest run src/points/expiry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 10: Write the failing test for `consumePointsFIFO`**

`packages/shared/src/points/fifo.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { consumePointsFIFO } from './fifo';

const batch = (entryId: string, remainingPoints: number, expiresAt: string) => ({
  entryId,
  points: remainingPoints,
  remainingPoints,
  expiresAt: new Date(expiresAt),
});

describe('consumePointsFIFO', () => {
  it('takes the oldest batch first', () => {
    const r = consumePointsFIFO(
      [
        batch('new', 10, '2026-07-01T00:00:00Z'),
        batch('old', 10, '2026-06-01T00:00:00Z'),
      ],
      4,
    );
    expect(r.consumed).toEqual([{ entryId: 'old', points: 4 }]);
    expect(r.shortfall).toBe(0);
  });

  it('spreads consumption across two batches', () => {
    const r = consumePointsFIFO(
      [
        batch('old', 10, '2026-06-01T00:00:00Z'),
        batch('new', 10, '2026-07-01T00:00:00Z'),
      ],
      15,
    );
    expect(r.consumed).toEqual([
      { entryId: 'old', points: 10 },
      { entryId: 'new', points: 5 },
    ]);
    expect(r.shortfall).toBe(0);
  });

  it('reports a shortfall when there are not enough points', () => {
    const r = consumePointsFIFO([batch('old', 5, '2026-06-01T00:00:00Z')], 8);
    expect(r.consumed).toEqual([{ entryId: 'old', points: 5 }]);
    expect(r.shortfall).toBe(3);
  });

  it('orders batches that expire on the same date deterministically by entry id', () => {
    const r = consumePointsFIFO(
      [
        batch('b', 10, '2026-06-01T00:00:00Z'),
        batch('a', 10, '2026-06-01T00:00:00Z'),
      ],
      10,
    );
    expect(r.consumed).toEqual([{ entryId: 'a', points: 10 }]);
  });

  it('ignores batches with no remaining points', () => {
    const r = consumePointsFIFO(
      [
        { entryId: 'empty', points: 0, remainingPoints: 0, expiresAt: new Date('2026-06-01T00:00:00Z') },
        batch('full', 10, '2026-07-01T00:00:00Z'),
      ],
      5,
    );
    expect(r.consumed).toEqual([{ entryId: 'full', points: 5 }]);
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `pnpm --filter @bokpoints/shared exec vitest run src/points/fifo.test.ts`
Expected: FAIL — cannot resolve `./fifo`.

- [ ] **Step 12: Implement `consumePointsFIFO`**

`packages/shared/src/points/fifo.ts`:
```ts
import type { ConsumedBatch, PointsBatch } from './types';

/**
 * Oldest points are used first (FIFO). Batches are ordered by expiry date,
 * then by entry id so the order is deterministic when two batches share a date.
 */
export function consumePointsFIFO(
  batches: PointsBatch[],
  amount: number,
): { consumed: ConsumedBatch[]; shortfall: number } {
  const ordered = [...batches]
    .filter((b) => b.remainingPoints > 0)
    .sort((a, b) => {
      const aExpiry = a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bExpiry = b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aExpiry !== bExpiry) return aExpiry - bExpiry;
      return a.entryId.localeCompare(b.entryId);
    });

  let remaining = amount;
  const consumed: ConsumedBatch[] = [];
  for (const batch of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(batch.remainingPoints, remaining);
    consumed.push({ entryId: batch.entryId, points: take });
    remaining -= take;
  }
  return { consumed, shortfall: remaining };
}
```

- [ ] **Step 13: Run the test to verify it passes**

Run: `pnpm --filter @bokpoints/shared exec vitest run src/points/fifo.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 14: Write the failing test for the balance functions**

`packages/shared/src/points/balance.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { adjustPoints, applyFraudClawback, balanceFromEntries } from './balance';

describe('balanceFromEntries', () => {
  it('sums ledger entries for a customer and store', () => {
    expect(
      balanceFromEntries([
        { type: 'earn', points: 23 },
        { type: 'adjust', points: -5 },
        { type: 'expire', points: -3 },
      ]),
    ).toBe(15);
  });

  it('is zero for an empty ledger', () => {
    expect(balanceFromEntries([])).toBe(0);
  });
});

describe('adjustPoints', () => {
  it('allows adding points', () => {
    expect(adjustPoints(5, 10)).toEqual({ ok: true, balance: 15 });
  });

  it('allows removing points that stay at or above zero', () => {
    expect(adjustPoints(5, 5)).toEqual({ ok: true, balance: 0 });
  });

  it('refuses a removal that would take the balance below zero (AC-11)', () => {
    const r = adjustPoints(5, 8);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BALANCE_WOULD_GO_NEGATIVE');
  });

  it('refuses a zero-point adjustment', () => {
    const r = adjustPoints(5, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_AMOUNT');
  });
});

describe('applyFraudClawback', () => {
  it('may take the balance below zero (AC-11)', () => {
    expect(applyFraudClawback(5, 8)).toEqual({ ok: true, balance: -3 });
  });

  it('refuses a zero-point clawback', () => {
    const r = applyFraudClawback(5, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_AMOUNT');
  });
});
```

- [ ] **Step 15: Run the test to verify it fails**

Run: `pnpm --filter @bokpoints/shared exec vitest run src/points/balance.test.ts`
Expected: FAIL — cannot resolve `./balance`.

- [ ] **Step 16: Implement the balance functions**

`packages/shared/src/points/balance.ts`:
```ts
import type { LedgerEntry, LedgerEntryType, PointsError, PointsErrorCode } from './types';

export function balanceFromEntries(entries: LedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.points, 0);
}

const error = (code: PointsErrorCode, message: string): PointsError => ({ code, message });

export function adjustPoints(
  balance: number,
  points: number,
): { ok: true; balance: number } | { ok: false; error: PointsError } {
  if (!Number.isInteger(points) || points === 0) {
    return { ok: false, error: error('INVALID_AMOUNT', 'Points must be a non-zero integer') };
  }
  const next = balance + points;
  if (next < 0) {
    return {
      ok: false,
      error: error(
        'BALANCE_WOULD_GO_NEGATIVE',
        'An adjustment may not take the balance below zero',
      ),
    };
  }
  return { ok: true, balance: next };
}

/**
 * The only action that may take a balance below zero (FR-PTS-8, FRD 4.6).
 */
export function applyFraudClawback(
  balance: number,
  points: number,
): { ok: true; balance: number } | { ok: false; error: PointsError } {
  if (!Number.isInteger(points) || points === 0) {
    return { ok: false, error: error('INVALID_AMOUNT', 'Points must be a non-zero integer') };
  }
  return { ok: true, balance: balance - points };
}
```

Also add to `packages/shared/src/points/types.ts`:
```ts
export type LedgerEntryType = 'earn' | 'redeem' | 'adjust' | 'expire' | 'fraud_clawback';
export interface LedgerEntry { type: LedgerEntryType; points: number }
export type PointsErrorCode = 'BALANCE_WOULD_GO_NEGATIVE' | 'INSUFFICIENT_POINTS' | 'INVALID_AMOUNT';
export interface PointsError { code: PointsErrorCode; message: string }
export interface PointsBatch { entryId: string; points: number; remainingPoints: number; expiresAt?: Date }
export interface ConsumedBatch { entryId: string; points: number }
```

- [ ] **Step 17: Run the test to verify it passes**

Run: `pnpm --filter @bokpoints/shared exec vitest run src/points/balance.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 18: Write the barrel and run the whole shared suite**

`packages/shared/src/index.ts` re-exports from `./points/types`, `./points/calculate`, `./points/expiry`, `./points/fifo`, `./points/balance`.

Run: `pnpm --filter @bokpoints/shared exec vitest run`
Expected: PASS, 24 tests across 4 files.

- [ ] **Step 19: Commit**

```bash
git add -A
git commit -m "Add points engine: calculation, expiry, FIFO and balance (FR-PTS-1, FR-PTS-8, FR-PTS-10)"
```

---

### Task 3: Role and capability matrix

**Files:**
- Create: `packages/shared/src/permissions.ts`
- Test: `packages/shared/src/permissions.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, exported from `@bokpoints/shared`:
  - `type Role = 'admin' | 'store_owner' | 'store_manager' | 'cashier' | 'customer'`
  - `type Capability = 'store.create' | 'store.manage' | 'store.status' | 'staff.manage' | 'points_rule.manage' | 'points.award' | 'points.adjust' | 'points.fraud_clawback' | 'devices.manage' | 'customers.list' | 'customers.view_scanned' | 'products.manage' | 'campaigns.manage' | 'points.view_own' | 'consent.manage_own' | 'audit.view'`
  - `interface PermissionDecision { allowed: boolean; scope: 'platform' | 'store' | 'own' | 'none' }`
  - `can(role: Role, capability: Capability): PermissionDecision`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/permissions.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { can } from './permissions';

describe('can', () => {
  it('lets an admin create and suspend stores', () => {
    expect(can('admin', 'store.create').allowed).toBe(true);
    expect(can('admin', 'store.status').allowed).toBe(true);
  });

  it('does not let an admin award points (FRD section 2)', () => {
    expect(can('admin', 'points.award').allowed).toBe(false);
  });

  it('does not let a cashier set points rules or adjust points (AC-4)', () => {
    expect(can('cashier', 'points_rule.manage').allowed).toBe(false);
    expect(can('cashier', 'points.adjust').allowed).toBe(false);
  });

  it('lets a cashier award points', () => {
    expect(can('cashier', 'points.award').allowed).toBe(true);
  });

  it('lets a manager adjust points but not claw back fraud', () => {
    expect(can('store_manager', 'points.adjust').allowed).toBe(true);
    expect(can('store_manager', 'points.fraud_clawback').allowed).toBe(false);
  });

  it('reserves the fraud clawback for admins', () => {
    expect(can('admin', 'points.fraud_clawback').allowed).toBe(true);
    expect(can('store_owner', 'points.fraud_clawback').allowed).toBe(false);
  });

  it('gives a customer only own-account capabilities', () => {
    expect(can('customer', 'points.view_own').allowed).toBe(true);
    expect(can('customer', 'consent.manage_own').allowed).toBe(true);
    expect(can('customer', 'customers.list').allowed).toBe(false);
  });

  it('scopes a store customer list to the store', () => {
    expect(can('store_owner', 'customers.list').scope).toBe('store');
    expect(can('store_manager', 'customers.list').scope).toBe('store');
  });

  it('gives a cashier only the scanned-customer view', () => {
    expect(can('cashier', 'customers.list').allowed).toBe(false);
    expect(can('cashier', 'customers.view_scanned').allowed).toBe(true);
  });

  it('scopes audit logs to the store for owners and managers', () => {
    expect(can('admin', 'audit.view').scope).toBe('platform');
    expect(can('store_owner', 'audit.view').scope).toBe('store');
    expect(can('cashier', 'audit.view').allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bokpoints/shared exec vitest run src/permissions.test.ts`
Expected: FAIL — cannot resolve `./permissions`.

- [ ] **Step 3: Implement the matrix**

`packages/shared/src/permissions.ts` encodes the FRD section 2 table as a lookup. Rows are `Role`; each maps a `Capability` to a `PermissionDecision`. Use `Record<Role, Partial<Record<Capability, PermissionDecision>>>`, and `can` returns `{ allowed: false, scope: 'none' }` for anything absent.

The table, straight from FRD section 2:

| Capability | admin | store_owner | store_manager | cashier | customer |
| --- | --- | --- | --- | --- | --- |
| store.create | platform | none | none | none | none |
| store.status | platform | none | none | none | none |
| store.manage | platform (support) | store | none | none | none |
| staff.manage | platform (support) | store | store | none | none |
| points_rule.manage | platform (support) | store | store | none | none |
| points.award | none | store | store | store | none |
| points.adjust | platform (support) | store | store | none | none |
| points.fraud_clawback | platform | none | none | none | none |
| devices.manage | platform (support) | store | store | none | none |
| customers.list | none (support lookup only) | store | store | none | none |
| customers.view_scanned | none | none | none | store | none |
| products.manage | none | store | store | none | none |
| campaigns.manage | none | store | store | none | none |
| points.view_own | none | none | none | none | own |
| consent.manage_own | own | own | own | own | own |
| audit.view | platform | store | store | none | none |

Note: the FRD shows admin as "support lookup only" for the customer list, which is a read-only lookup, not the store customer list. Model that as `allowed: false, scope: 'none'` for `customers.list` and let a separate admin support lookup capability cover it. Add `customers.lookup` with `platform` scope for admins only.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bokpoints/shared exec vitest run src/permissions.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Export from the barrel and run the full shared suite**

Modify `packages/shared/src/index.ts` to also `export * from './permissions';`

Run: `pnpm --filter @bokpoints/shared exec vitest run`
Expected: PASS, 34 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add role and capability matrix (FR-AUTH-6, FRD section 2)"
```

---

### Task 4: Database schema and migrations

**Files:**
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/migrations/0000_init.sql` (generated, then hand-edited)
- Modify: `apps/api/package.json` (add `db:push` script if needed)

**Interfaces:**
- Consumes: `@bokpoints/shared` (types only).
- Produces: exported Drizzle table objects from `apps/api/src/db/schema.ts`:
  `customers`, `staffUsers`, `stores`, `storeMembers`, `cashierDevices`, `credentials`, `customerStoreLinks`, `pointsRules`, `pointsLedgerEntries`, `pointsBalances`, `rejectedOfflineAwards`, `subscriptions`, `auditLogEntries`.
  Plus `apps/api/src/db/client.ts` exporting `createDb(pool)` and `db` (a lazily created instance reading `DATABASE_URL`).

- [ ] **Step 1: Write the Drizzle config**

`apps/api/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/bokpoints_dev' },
});
```

- [ ] **Step 2: Write the schema**

`apps/api/src/db/schema.ts` defines the 13 tables. Required details:

- All money columns are `integer` named `*Cents`. All points columns are `integer`.
- `customers`: `id` uuid PK default random, `email` text NOT NULL UNIQUE, `name` text NOT NULL, `phone` text, `emailVerifiedAt` timestamptz, `language` text NOT NULL default `'fi'`, `status` text NOT NULL default `'active'` CHECK in (`'active'`,`'deleted'`), `createdAt`, `updatedAt`.
- `staffUsers`: `id` uuid PK, `email` text NOT NULL UNIQUE, `name` text NOT NULL, `mfaEnabled` boolean NOT NULL default false, `status` text NOT NULL default `'active'`, `createdAt`.
- `stores`: `id` uuid PK, `name` text NOT NULL, `businessId` text, `address` text, `contactName` text, `contactEmail` text, `vatId` text, `status` text NOT NULL default `'invited'` CHECK in (`'invited'`,`'setup'`,`'active'`,`'paused'`,`'suspended'`,`'offboarded'`), `plan` text, `createdAt`, `updatedAt`.
- `storeMembers`: `id` uuid PK, `storeId` uuid NOT NULL FK → stores, `userId` uuid NOT NULL FK → staffUsers, `role` text NOT NULL CHECK in (`'owner'`,`'manager'`,`'cashier'`), `status` text NOT NULL default `'active'` CHECK in (`'active'`,`'deactivated'`), `createdAt`. UNIQUE (`storeId`,`userId`).
- `cashierDevices`: `id` uuid PK, `storeId` uuid NOT NULL FK → stores, `name` text NOT NULL, `status` text NOT NULL default `'active'` CHECK in (`'active'`,`'revoked'`), `lastSyncAt` timestamptz, `registeredBy` uuid FK → staffUsers, `createdAt`.
- `credentials`: `id` uuid PK, `customerId` uuid NOT NULL FK → customers, `type` text NOT NULL CHECK in (`'app_qr'`,`'nfc_card'`,`'wallet_pass'`), `identifier` text NOT NULL, `devicePublicKey` text, `validUntil` timestamptz, `status` text NOT NULL default `'active'` CHECK in (`'active'`,`'lost'`,`'revoked'`), `createdAt`. UNIQUE (`type`,`identifier`).
- `customerStoreLinks`: `id` uuid PK, `customerId` uuid NOT NULL FK → customers, `storeId` uuid NOT NULL FK → stores, `joinedAt` timestamptz NOT NULL default now, `marketingConsent` boolean NOT NULL default false, `status` text NOT NULL default `'active'` CHECK in (`'active'`,`'under_fraud_review'`). UNIQUE (`customerId`,`storeId`).
- `pointsRules`: `id` uuid PK, `storeId` uuid NOT NULL FK → stores, `ruleVersion` integer NOT NULL, `pointsPerEuroThousandths` integer NOT NULL CHECK > 0, `minPurchaseCents` integer CHECK >= 0, `maxPointsPerTransaction` integer CHECK >= 0, `rounding` text NOT NULL default `'floor'` CHECK in (`'floor'`,`'nearest'`), `activeFrom` timestamptz NOT NULL, `createdAt`. UNIQUE (`storeId`,`ruleVersion`).
- `pointsLedgerEntries`: `id` uuid PK, `customerId` uuid NOT NULL FK → customers, `storeId` uuid NOT NULL FK → stores, `type` text NOT NULL CHECK in (`'earn'`,`'redeem'`,`'adjust'`,`'expire'`,`'fraud_clawback'`), `points` integer NOT NULL, `amountCents` integer, `remainingPoints` integer, `expiresAt` timestamptz, `ruleVersion` integer, `reason` text, `staffId` uuid FK → staffUsers, `deviceId` uuid FK → cashierDevices, `scannedAt` timestamptz, `idempotencyKey` text, `createdAt` timestamptz NOT NULL default now.
  - CHECK constraint named `points_ledger_entries_points_sign`: `("points" >= 0 OR "type" = 'fraud_clawback')`.
  - CHECK constraint named `points_ledger_entries_remaining`: `("remainingPoints" IS NULL OR ("remainingPoints" >= 0 AND "remainingPoints" <= "points"))`.
  - Partial UNIQUE index on `idempotency_key` WHERE `idempotency_key IS NOT NULL`.
- `pointsBalances`: `customerId` uuid NOT NULL FK → customers, `storeId` uuid NOT NULL FK → stores, `balance` integer NOT NULL default 0, `updatedAt` timestamptz NOT NULL default now. PRIMARY KEY (`customerId`,`storeId`).
- `rejectedOfflineAwards`: `id` uuid PK, `storeId` uuid NOT NULL FK → stores, `deviceId` uuid FK → cashierDevices, `customerId` uuid FK → customers, `amountCents` integer NOT NULL, `scannedAt` timestamptz NOT NULL, `reason` text NOT NULL, `reviewedBy` uuid FK → staffUsers, `reviewedAt` timestamptz, `createdAt`.
- `subscriptions`: `id` uuid PK, `storeId` uuid NOT NULL UNIQUE FK → stores, `plan` text NOT NULL, `status` text NOT NULL CHECK in (`'trialing'`,`'active'`,`'past_due'`,`'paused'`,`'suspended'`,`'canceled'`), `currentPeriodStart` timestamptz, `currentPeriodEnd` timestamptz, `firstFailedPaymentAt` timestamptz, `providerCustomerId` text, `providerSubscriptionId` text, `createdAt`, `updatedAt`.
- `auditLogEntries`: `id` uuid PK, `actorId` uuid, `actorRole` text, `action` text NOT NULL, `storeId` uuid FK → stores, `targetType` text, `targetId` uuid, `before` jsonb, `after` jsonb, `reason` text, `createdAt` timestamptz NOT NULL default now.

- [ ] **Step 3: Write the DB client**

`apps/api/src/db/client.ts`:
```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}
```

- [ ] **Step 4: Generate the migration**

Run: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/bokpoints_dev pnpm --filter @bokpoints/api db:generate`
Expected: `apps/api/src/db/migrations/0000_*.sql` created, plus `drizzle/meta/`.

- [ ] **Step 5: Hand-add the append-only triggers to the migration**

Append to the generated SQL in `apps/api/src/db/migrations/0000_*.sql`:
```sql
CREATE OR REPLACE FUNCTION prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER points_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON points_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER audit_log_entries_append_only
  BEFORE UPDATE OR DELETE ON audit_log_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
```

This is what makes the append-only rule real rather than a convention (FRD section 3, FR-AUD-2).

- [ ] **Step 6: Apply the migration to a real database**

Run: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/bokpoints_dev pnpm --filter @bokpoints/api db:migrate`
Expected: migration applied, no error.

- [ ] **Step 7: Verify the constraints actually hold**

Run against `bokpoints_dev`:
```sql
INSERT INTO points_ledger_entries (id, customer_id, store_id, type, points)
VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'adjust', -5);
```
Expected: ERROR — violates `points_ledger_entries_points_sign`.

Then attempt `UPDATE points_ledger_entries SET points = 1;`
Expected: ERROR — table is append-only.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add ledger schema, append-only triggers and migrations (FR-AUD-2, FRD section 3)"
```

---

### Task 5: Transactional ledger write path with integration tests

**Files:**
- Create: `apps/api/src/db/ledger.ts`
- Create: `apps/api/test/integration/ledger.test.ts`
- Create: `apps/api/vitest.config.ts`
- Modify: `vitest.config.ts` (root) if the workspace uses per-project config

**Interfaces:**
- Consumes: `@bokpoints/shared` (`calculatePoints`, `expiryDateForEarn`, `adjustPoints`, `applyFraudClawback`, `PointsRule`), `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`.
- Produces, exported from `apps/api/src/db/ledger.ts`:
  - `interface RecordEarnInput { customerId: string; storeId: string; amountCents: number; rule: PointsRule; ruleVersion: number; idempotencyKey: string; scannedAt?: Date; staffId?: string; deviceId?: string }`
  - `interface RecordEarnResult { entryId: string; points: number; awarded: boolean }`
  - `recordEarn(db: Database, input: RecordEarnInput): Promise<RecordEarnResult>`
  - `recordAdjust(db: Database, input: { customerId: string; storeId: string; points: number; reason: string; staffId: string }): Promise<{ entryId: string; balance: number }>`
  - `recordFraudClawback(db: Database, input: { customerId: string; storeId: string; points: number; caseNote: string; staffId: string }): Promise<{ entryId: string; balance: number }>`
  - `getBalance(db: Database, customerId: string, storeId: string): Promise<number>`

- [ ] **Step 1: Write the Vitest projects config**

Root `vitest.config.ts` defines two projects: `unit` (includes `packages/*/src/**/*.test.ts` and `apps/api/test/unit/**`) and `integration` (includes `apps/api/test/integration/**`, with a longer timeout and serial execution). The integration project reads `DATABASE_URL` from the environment and must not fall back to a shared database.

- [ ] **Step 2: Write the failing integration test**

`apps/api/test/integration/ledger.test.ts` sets up a fresh schema per test file by dropping and re-applying the migrations, then covers:

- **AC-2 idempotency**: call `recordEarn` twice with the same `idempotencyKey`; the balance rises once and both calls return the same `entryId`.
- **AC-3 store isolation**: a customer with an award at Store A and Store B; `getBalance` for Store A returns only Store A's points, and a query for the customer's Store A history returns only Store A rows.
- **AC-11 no negative balance**: `recordAdjust` removing 8 points from a balance of 5 is rejected and writes no ledger entry; `recordFraudClawback` of 8 points succeeds and the balance becomes -3.
- **Atomicity**: a forced failure between the ledger insert and the balance update leaves no ledger entry. Force it by passing a `reason` longer than the column allows on the adjust path and asserting that no entry and no balance change exist afterwards.
- **Append-only**: an `UPDATE` on a ledger row throws.
- **Earn creates the customer-store link**: after a first award, a `customerStoreLinks` row exists for that customer and store.
- **Idempotency scope**: the same `idempotencyKey` used at a *different* store creates a separate award (the key is scoped per store).

- [ ] **Step 3: Run the test to verify it fails**

Run: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/bokpoints_test pnpm test:integration`
Expected: FAIL — cannot resolve `../../src/db/ledger`.

- [ ] **Step 4: Implement `recordEarn`**

`apps/api/src/db/ledger.ts`. The write path, in one transaction:

1. Look for an existing ledger entry with the same `idempotencyKey` for this store. If found, return it unchanged — this is the retry guard (FR-PTS-4, AC-2).
2. Compute `calculatePoints(input.amountCents, input.rule)`. If `!awarded`, throw a typed error `below_minimum`.
3. Compute `expiresAt = expiryDateForEarn(scannedAt ?? now)`.
4. Insert the ledger entry with `type: 'earn'`, `points`, `amountCents`, `remainingPoints: points`, `expiresAt`, `ruleVersion`, `idempotencyKey`, `scannedAt`.
5. Upsert `pointsBalances` for (`customerId`,`storeId`): `balance = balance + points` using an atomic `ON CONFLICT DO UPDATE SET balance = points_balances.balance + EXCLUDED.balance`.
6. Insert the `customerStoreLinks` row if it does not exist (first purchase at this store, FRD 4.3).
7. Insert an `auditLogEntries` row for the award.
8. Commit and return `{ entryId, points, awarded: true }`.

Every step must run inside a single `db.transaction(...)` so the ledger entry and the balance update are atomic (FR-PTS-5).

- [ ] **Step 5: Implement `recordAdjust`, `recordFraudClawback` and `getBalance`**

- `recordAdjust`: inside a transaction, read the current balance for the store, call `adjustPoints(balance, points)`; on `ok: false` throw the typed error and write nothing. On success insert an `adjust` entry with the required `reason` and update the balance.
- `recordFraudClawback`: inside a transaction, call `applyFraudClawback(balance, points)`, insert a `fraud_clawback` entry with the `caseNote` as `reason`, update the balance (which may go negative), and set the `customerStoreLinks.status` to `'under_fraud_review'` (FRD 4.6).
- `getBalance`: select `balance` from `pointsBalances` for (`customerId`,`storeId`), returning `0` when no row exists.

- [ ] **Step 6: Run the integration tests to verify they pass**

Run: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/bokpoints_test pnpm test:integration`
Expected: PASS, all cases above.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add transactional ledger write path with idempotency (FR-PTS-4, FR-PTS-5, AC-2, AC-11)"
```

---

### Task 6: API skeleton

**Files:**
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/test/unit/app.test.ts`

**Interfaces:**
- Consumes: `apps/api/src/db/client.ts`.
- Produces: `buildApp(options?: { db?: Database }): Promise<FastifyInstance>` from `apps/api/src/app.ts`, with route `GET /v1/health` returning `{ status: 'ok', version: string }` and route `GET /v1/ping`.

- [ ] **Step 1: Write the failing unit test**

`apps/api/test/unit/app.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';

describe('buildApp', () => {
  it('serves a health check', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    await app.close();
  });

  it('returns 404 for an unknown route', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bokpoints/api exec vitest run test/unit/app.test.ts`
Expected: FAIL — cannot resolve `../../src/app`.

- [ ] **Step 3: Implement `env.ts`, `app.ts` and `server.ts`**

- `env.ts` validates `process.env` with Zod: `PORT` (default 3000), `HOST` (default `127.0.0.1`), `LOG_LEVEL` (default `info`), `DATABASE_URL` (required, no default in production).
- `app.ts` builds the Fastify instance, registers the `/v1/health` and `/v1/ping` routes, and closes the database pool on `onClose` when it opened one.
- `server.ts` reads the env, calls `buildApp()` and listens.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bokpoints/api exec vitest run test/unit/app.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Verify the server actually boots**

Run: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/bokpoints_dev pnpm --filter @bokpoints/api dev`
Expected: server listening on 127.0.0.1:3000, `curl http://127.0.0.1:3000/v1/health` returns `{"status":"ok"}`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add Fastify API skeleton with health endpoint"
```

---

### Task 7: Documentation, handoff and the private GitHub repo

**Files:**
- Create: `README.md`
- Modify: `AGENT.md` (section 5 commands, section 16 known unknowns if hosting is still open)
- Modify: `docs/DECISIONS.md` (append new rows)
- Modify: `docs/HANDOFF.md` (current state, next steps, session log)
- Create: `handoff/README.md`, `handoff/STATUS.md`, `handoff/DECISIONS.md`, `handoff/RUNBOOK.md`
- Create: `.github/ISSUE_TEMPLATE/` if useful — optional, skip unless time allows

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a documented repository, and a private GitHub remote named `origin`.

- [ ] **Step 1: Write the README**

`README.md` covers: what BOKPOINTS is (two sentences), the stack, prerequisites (Node 24+, pnpm, PostgreSQL 17), how to install and run, how to run each check, the repository layout, and a link to `docs/PRD.md`, `docs/FRD.md` and `AGENT.md`.

- [ ] **Step 2: Update `AGENT.md` section 5 with the real commands**

Replace the placeholder command list with the actual scripts, and note that the commands now exist. Keep the section's instruction that it must be updated whenever a script changes.

- [ ] **Step 3: Append new decisions to `docs/DECISIONS.md`**

Append these rows to the Technology table, each with the next free ID after D-062:

| ID | Decision | Why | Status | Source |
| --- | --- | --- | --- | --- |
| D-063 | TypeScript 6.0.3, not 7.0.2 | typescript-eslint 8.72.0 requires `typescript >=4.8.4 <6.1.0`; TypeScript 7 is not yet supported by the linter | Decided | AGENT.md 3 |
| D-064 | Vitest 4.1.12, not 5.x | Vitest 5 requires Node `^22.12 \|\| ^24 \|\| >=26` and excludes the installed Node 25; Vitest 4 accepts `>=24` | Decided | AGENT.md 3 |
| D-065 | `pointsPerEuro` is stored in thousandths as an integer | Keeps every points calculation in integer maths, so the server and the offline till cannot disagree on a balance (AGENT.md 6) | Decided | FR-PTS-1 |
| D-066 | Expiry clamps to the last day of a short target month | "3 months after the day they were earned" has no exact answer for 31 January; clamping to 30 April is the reading that never expires points early | Decided | FR-PTS-10, AC-6 |
| D-067 | The ledger and audit log are protected by database triggers, not only application code | The append-only rule is a product invariant, so the database must refuse the write even if application code is wrong (FR-AUD-2) | Decided | FR-AUD-2 |
| D-068 | A non-negative balance is enforced by a CHECK on the ledger plus transaction logic, not by a CHECK on the balance row | A fraud clawback is allowed to go below zero, which a `balance >= 0` constraint cannot express | Decided | FR-PTS-8, AC-11 |
| D-069 | Local PostgreSQL 17 via Homebrew is the development and integration-test database | `AGENT.md` requires integration tests against a real Postgres; PGlite is not a real server | Decided | AGENT.md 5, 12 |
| D-070 | The repository is private at github.com/AbdKabeer1/bokpoints | Unreleased product with unreviewed legal and privacy text | Decided | This session |

Also update the "Open decisions (not yet made)" list to remove nothing and add the offline QR design as still open, as the AGENT.md requires.

- [ ] **Step 4: Update `docs/HANDOFF.md`**

Set "Last updated" to Oct 2026 and Phase to **build started**. Update the "Current state" table: PRD v0.2 exported to `docs/PRD.md`, FRD v0.2 exported to `docs/FRD.md`, AGENT.md v0.1 with real commands, HANDOFF.md and DECISIONS.md updated, Repository = created at `~/bokpoints` with a private GitHub remote, Code = monorepo skeleton, shared points engine and ledger schema, Accounts = still none confirmed, Pilot stores = none chosen.

Replace "Next steps" with the remaining build-order items: step 3 (auth and roles; admin store onboarding), step 4 (Cashier screen, online flow only), step 5 (customer app), step 6 (pending customers, adjustments, audit log UI), step 7 (billing), step 8 (offline awarding), step 9 (reports and hardening).

Add a session-log row: `| Build 1 | Created the repo, monorepo skeleton and CI; built the points engine with unit tests; defined the ledger schema, migrations and append-only triggers; added the transactional ledger write path with integration tests; added the Fastify skeleton | ... | ... |`.

- [ ] **Step 5: Write the `handoff/` folder**

Create `handoff/README.md` (goal, deliverables, acceptance criteria, deadline), `handoff/STATUS.md` (Done / In progress / Blocked / Next), `handoff/DECISIONS.md` (a pointer to `docs/DECISIONS.md` plus the session's new rows), and `handoff/RUNBOOK.md` (setup, run, test and deploy commands). Keep `handoff/DECISIONS.md` pointing at the canonical log rather than duplicating it.

- [ ] **Step 6: Run the full verification suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass, no errors.

Run: `DATABASE_URL=postgres://postgres:postgres@localhost:5432/bokpoints_test pnpm test:integration`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Document the build: README, handoff and decision log updates"
```

- [ ] **Step 8: Create the private GitHub repository and push**

```bash
gh repo create AbdKabeer1/bokpoints --private --source=. --remote=origin --push
```
Expected: remote `origin` created, branch `main` pushed.

- [ ] **Step 9: Verify the push**

Run: `git remote -v && git status && gh repo view AbdKabeer1/bokpoints --json name,visibility,url`
Expected: `visibility: "PRIVATE"`, `origin` pointing at the new repo, working tree clean.

---

## Self-Review

**1. Spec coverage.** The PRD and FRD are large; this plan deliberately covers build-order steps 1 and 2 only, as agreed with the product owner.

| Requirement | Covered by |
| --- | --- |
| FR-PTS-1, FR-PTS-2, FR-PTS-3 | Task 2, `calculatePoints` |
| FR-PTS-4 | Task 5, `recordEarn` idempotency, AC-2 |
| FR-PTS-5 | Task 5, single transaction |
| FR-PTS-8 | Task 2 `adjustPoints`, Task 4 CHECK, Task 5 AC-11 |
| FR-PTS-10, AC-6 | Task 2, `expiryDateForEarn` |
| FR-STO-7 (FIFO) | Task 2, `consumePointsFIFO` |
| FR-AUTH-6 | Task 3, `can` |
| FR-AUD-2 | Task 4, append-only triggers |
| FRD section 3 data model | Task 4, 13 tables |
| FRD section 2 permissions | Task 3 |
| AGENT.md section 12 unit test scope | Task 2, Task 3 |
| AGENT.md section 4 repository layout | Task 1 |
| AGENT.md section 5 commands | Task 1, Task 7 |
| AGENT.md section 13 build order steps 1-2 | Tasks 1-5 |
| FR-CRD-2 QR verification | **Not covered** — offline awarding is build-order step 8 and needs its own design decision |
| FR-BIL-*, FR-NTF-*, FR-AUTH-1..5 | **Not covered** — build-order steps 3 and 7 |
| FR-CUS-*, FR-STO-1..22 | **Not covered** — build-order steps 4 and 5 |
| FR-AUD-3..5, FR-PRV-*, FR-LOC-* | **Not covered** — build-order steps 6 and 9 |

**2. Step scan.** Every step names exact files, exact commands and exact expected output. No step says "add appropriate validation" or "write tests for the above". Function bodies appear only where the algorithm is fixed by the spec (the 100_000 scale, the month clamp, the FIFO ordering).

**3. Type consistency.** `PointsRule`, `PointsCalculation`, `PointsBatch`, `ConsumedBatch`, `LedgerEntry`, `PointsError` are defined once in `packages/shared/src/points/types.ts` and imported everywhere. `recordEarn` returns `RecordEarnResult`. `getBalance` returns `Promise<number>`. `can` returns `PermissionDecision`. Task 5 imports `calculatePoints`, `expiryDateForEarn`, `adjustPoints` and `applyFraudClawback` from `@bokpoints/shared`, all of which Task 2 exports.

**4. Review Focus.** Each of the five lines maps to a test in the owning task: zero and negative amounts → Task 2 `calculatePoints`; minimum boundary equality → Task 2 `calculatePoints`; short-month expiry → Task 2 `expiryDateForEarn`; FIFO with equal expiry dates → Task 2 `consumePointsFIFO`; idempotency scope across stores → Task 5 integration test.

**5. Proportion.** The plan is roughly 1.5 times the length of the code it produces. Steps carry signatures, test names, assertions and commands; bodies appear only where the spec fixes the algorithm.

## Execution Handoff

This plan implements the agreed scope: build-order steps 1 and 2 of `AGENT.md` section 13, as approved by the product owner.
