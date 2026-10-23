import { and, desc, eq, lte } from 'drizzle-orm';
import type { EarningRule } from '@bokpoints/shared';
import type { Database } from './client.js';
import { earningRules, pointsRules, stores } from './schema.js';

/**
 * The store's earning program: its active rules and the per-sale ceiling
 * (WP2, D-116, D-121).
 */
export interface StoreProgram {
  rules: EarningRule[];
  maxPointsPerSale?: number;
}

export function toEngineRule(row: {
  id: string;
  type: string;
  params: unknown;
  conditions: unknown;
  version: number;
}): EarningRule {
  const params = (row.params ?? {}) as Record<string, unknown>;
  const conditions = (row.conditions ?? {}) as Record<string, unknown>;
  const minSpend = conditions['minSpendCents'];
  const minSpendCents = typeof minSpend === 'number' ? minSpend : undefined;
  const base = {
    id: row.id,
    version: row.version,
    ...(minSpendCents === undefined ? {} : { minSpendCents }),
  };

  if (row.type === 'per_euro') {
    const rate = params['pointsPerEuroThousandths'];
    if (typeof rate !== 'number') {
      throw new Error(`Earning rule ${row.id} has no pointsPerEuroThousandths`);
    }
    return {
      ...base,
      type: 'per_euro',
      pointsPerEuroThousandths: rate,
      rounding: params['rounding'] === 'nearest' ? 'nearest' : 'floor',
    };
  }

  if (row.type === 'fixed_per_purchase' || row.type === 'threshold_bonus') {
    const points = params['points'];
    if (typeof points !== 'number') {
      throw new Error(`Earning rule ${row.id} has no points`);
    }
    return { ...base, type: row.type, points };
  }

  throw new Error(`Earning rule ${row.id} has an unknown type: ${row.type}`);
}

/**
 * What the store awards with right now: its active rules that have taken
 * effect, plus the store's per-sale ceiling.
 *
 * A store with no earning-rule rows falls back to its legacy `points_rules`
 * row as a single per-euro rule. The migration converts every existing store,
 * so the fallback only covers a store created by an older process and the
 * integration fixtures that still seed `points_rules` directly; it goes away
 * when the legacy table does (WP3).
 */
export async function currentProgramFor(
  db: Database,
  storeId: string,
): Promise<StoreProgram | null> {
  const storeRows = await db
    .select({ maxPointsPerSale: stores.maxPointsPerSale })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  const store = storeRows[0];
  if (!store) return null;

  const rows = await db
    .select({
      id: earningRules.id,
      type: earningRules.type,
      params: earningRules.params,
      conditions: earningRules.conditions,
      version: earningRules.version,
    })
    .from(earningRules)
    .where(
      and(
        eq(earningRules.storeId, storeId),
        eq(earningRules.status, 'active'),
        lte(earningRules.effectiveFrom, new Date()),
      ),
    )
    .orderBy(desc(earningRules.version));

  if (rows.length > 0) {
    return {
      rules: rows.map(toEngineRule),
      ...(store.maxPointsPerSale === null ? {} : { maxPointsPerSale: store.maxPointsPerSale }),
    };
  }

  const legacy = await db
    .select()
    .from(pointsRules)
    .where(and(eq(pointsRules.storeId, storeId), lte(pointsRules.activeFrom, new Date())))
    .orderBy(desc(pointsRules.ruleVersion))
    .limit(1);
  const row = legacy[0];
  if (!row) return null;

  return {
    rules: [
      {
        id: row.id,
        type: 'per_euro',
        version: row.ruleVersion,
        pointsPerEuroThousandths: row.pointsPerEuroThousandths,
        rounding: row.rounding === 'nearest' ? 'nearest' : 'floor',
        ...(row.minPurchaseCents === null ? {} : { minSpendCents: row.minPurchaseCents }),
      },
    ],
    ...(store.maxPointsPerSale !== null
      ? { maxPointsPerSale: store.maxPointsPerSale }
      : row.maxPointsPerTransaction !== null
        ? { maxPointsPerSale: row.maxPointsPerTransaction }
        : {}),
  };
}
