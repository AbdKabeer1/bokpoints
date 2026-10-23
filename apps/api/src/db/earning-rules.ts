import { and, desc, eq, lte, sql } from 'drizzle-orm';
import type { EarningRule } from '@bokpoints/shared';
import type { Database } from './client.js';
import { earningRules, pointsRules, stores } from './schema.js';

/** A transaction handle, as handed to callbacks of db.transaction. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

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

  if (row.type === 'every_nth_visit') {
    const points = params['points'];
    const everyN = params['everyN'];
    if (typeof points !== 'number' || typeof everyN !== 'number') {
      throw new Error(`Earning rule ${row.id} needs points and everyN`);
    }
    return { ...base, type: 'every_nth_visit', points, everyN };
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

  // A store whose rules are all paused or superseded has no program: it
  // stops awarding. The legacy fallback is only for a store that never
  // got an earning-rule row at all (an older process, or the integration
  // fixtures that still seed points_rules); it goes away when the legacy
  // table does (WP3).
  const migratedStore = await db
    .select({ id: earningRules.id })
    .from(earningRules)
    .where(eq(earningRules.storeId, storeId))
    .limit(1);
  if (migratedStore[0]) return null;

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

/**
 * A rule the way the owner portal sends and receives it: the engine rule
 * without the server-set identifiers.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RuleDefinition = DistributiveOmit<EarningRule, 'id' | 'version'>;

/** Reads one stored row back into a definition, ready to display or edit. */
export function ruleDefinitionFromRow(row: {
  type: string;
  params: unknown;
  conditions: unknown;
}): RuleDefinition {
  const params = (row.params ?? {}) as Record<string, unknown>;
  const conditions = (row.conditions ?? {}) as Record<string, unknown>;
  const condition = conditions['minSpendCents'];
  const minSpendCents = typeof condition === 'number' ? condition : undefined;

  switch (row.type) {
    case 'per_euro': {
      const rate = params['pointsPerEuroThousandths'];
      if (typeof rate !== 'number') {
        throw new Error('Earning rule has no pointsPerEuroThousandths');
      }
      return {
        type: 'per_euro',
        pointsPerEuroThousandths: rate,
        rounding: params['rounding'] === 'nearest' ? 'nearest' : 'floor',
        ...(minSpendCents === undefined ? {} : { minSpendCents }),
      };
    }
    case 'every_nth_visit': {
      const points = params['points'];
      const everyN = params['everyN'];
      if (typeof points !== 'number' || typeof everyN !== 'number') {
        throw new Error('Earning rule needs points and everyN');
      }
      return { type: 'every_nth_visit', points, everyN };
    }
    case 'fixed_per_purchase':
    case 'threshold_bonus': {
      const points = params['points'];
      if (typeof points !== 'number') {
        throw new Error('Earning rule has no points');
      }
      return {
        type: row.type,
        points,
        ...(minSpendCents === undefined ? {} : { minSpendCents }),
      };
    }
    default:
      throw new Error(`Earning rule has an unknown type: ${row.type}`);
  }
}

export function paramsFromDefinition(definition: RuleDefinition): Record<string, unknown> {
  if (definition.type === 'per_euro') {
    return {
      pointsPerEuroThousandths: definition.pointsPerEuroThousandths,
      rounding: definition.rounding ?? 'floor',
    };
  }
  if (definition.type === 'every_nth_visit') {
    return { points: definition.points, everyN: definition.everyN };
  }
  return { points: definition.points };
}

export function conditionsFromDefinition(
  definition: RuleDefinition,
): Record<string, unknown> {
  if ('minSpendCents' in definition && definition.minSpendCents !== undefined) {
    return { minSpendCents: definition.minSpendCents };
  }
  return {};
}

/**
 * A definition into the engine's shape for validation and simulation. The
 * version is only there to satisfy the engine; the stored version is set by
 * the caller.
 */
export function engineRuleFromDefinition(
  definition: RuleDefinition,
  version = 1,
): EarningRule {
  return {
    ...definition,
    version,
  } as EarningRule;
}

export interface StoredRule {
  id: string;
  ruleKey: string;
  definition: RuleDefinition;
  version: number;
  status: 'active' | 'paused' | 'superseded';
  effectiveFrom: Date;
  createdAt: Date;
}

/**
 * Every rule version the store has, newest change first (FR-RUL-4): the
 * history is append-only, so this is what the owner portal edits against.
 * Returns null when the store does not exist.
 */
export async function listStoreRules(
  db: Database,
  storeId: string,
): Promise<StoredRule[] | null> {
  const exists = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!exists[0]) return null;

  const rows = await db
    .select({
      id: earningRules.id,
      ruleKey: earningRules.ruleKey,
      type: earningRules.type,
      params: earningRules.params,
      conditions: earningRules.conditions,
      version: earningRules.version,
      status: earningRules.status,
      effectiveFrom: earningRules.effectiveFrom,
      createdAt: earningRules.createdAt,
    })
    .from(earningRules)
    .where(eq(earningRules.storeId, storeId))
    .orderBy(desc(earningRules.version), desc(earningRules.createdAt));

  return rows.map((row) => ({
    id: row.id,
    ruleKey: row.ruleKey,
    definition: ruleDefinitionFromRow(row),
    version: row.version,
    status: row.status as StoredRule['status'],
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt,
  }));
}

/**
 * The store's next rule version. Version counts rule changes for the whole
 * store (unique index on store_id + version), so every mutation takes the
 * next number even when it touches one rule.
 */
export async function nextStoreRuleVersion(
  db: Database | Tx,
  storeId: string,
): Promise<number> {
  const rows = await db
    .select({ maxVersion: sql<number>`coalesce(max(${earningRules.version}), 0)::int` })
    .from(earningRules)
    .where(eq(earningRules.storeId, storeId));
  return (rows[0]?.maxVersion ?? 0) + 1;
}
