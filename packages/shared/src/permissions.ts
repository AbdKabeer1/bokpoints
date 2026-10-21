/**
 * The roles from FRD section 2. A person can hold different roles in
 * different stores. Admin accounts are separate from store and customer
 * accounts.
 */
export type Role = 'admin' | 'store_owner' | 'store_manager' | 'cashier' | 'customer';

export type Capability =
  | 'store.create'
  | 'store.status'
  | 'store.manage'
  | 'staff.manage'
  | 'points_rule.manage'
  | 'points.award'
  | 'points.adjust'
  | 'points.fraud_clawback'
  | 'devices.manage'
  | 'customers.list'
  | 'customers.lookup'
  | 'customers.view_scanned'
  | 'products.manage'
  | 'campaigns.manage'
  | 'points.view_own'
  | 'consent.manage_own'
  | 'audit.view';

/**
 * How far a granted capability reaches.
 * - `platform`: the whole platform, admin only.
 * - `store`: the caller's own store only.
 * - `own`: the caller's own account only.
 * - `none`: not granted.
 */
export type PermissionScope = 'platform' | 'store' | 'own' | 'none';

export interface PermissionDecision {
  allowed: boolean;
  scope: PermissionScope;
}

const NONE: PermissionDecision = { allowed: false, scope: 'none' };

const grant = (scope: PermissionScope): PermissionDecision => ({ allowed: true, scope });

/**
 * The FRD section 2 permissions table, one row per role.
 *
 * Hiding a button in the UI is never access control (FR-AUTH-6): this table
 * is enforced on the server, in every query.
 */
const MATRIX: Record<Role, Partial<Record<Capability, PermissionDecision>>> = {
  admin: {
    'store.create': grant('platform'),
    'store.status': grant('platform'),
    'store.manage': grant('platform'),
    'staff.manage': grant('platform'),
    'points_rule.manage': grant('platform'),
    // FRD section 2: an admin does not award points.
    'points.adjust': grant('platform'),
    'points.fraud_clawback': grant('platform'),
    'devices.manage': grant('platform'),
    // FRD section 2: support lookup only, not the store customer list.
    'customers.lookup': grant('platform'),
    'consent.manage_own': grant('own'),
    'audit.view': grant('platform'),
  },
  store_owner: {
    'store.manage': grant('store'),
    'staff.manage': grant('store'),
    'points_rule.manage': grant('store'),
    'points.award': grant('store'),
    'points.adjust': grant('store'),
    'devices.manage': grant('store'),
    'customers.list': grant('store'),
    'products.manage': grant('store'),
    'campaigns.manage': grant('store'),
    'consent.manage_own': grant('own'),
    'audit.view': grant('store'),
  },
  store_manager: {
    'staff.manage': grant('store'),
    'points_rule.manage': grant('store'),
    'points.award': grant('store'),
    'points.adjust': grant('store'),
    'devices.manage': grant('store'),
    'customers.list': grant('store'),
    'products.manage': grant('store'),
    'campaigns.manage': grant('store'),
    'consent.manage_own': grant('own'),
    'audit.view': grant('store'),
  },
  cashier: {
    'points.award': grant('store'),
    'customers.view_scanned': grant('store'),
    'consent.manage_own': grant('own'),
  },
  customer: {
    'points.view_own': grant('own'),
    'consent.manage_own': grant('own'),
  },
};

export function can(role: Role, capability: Capability): PermissionDecision {
  return MATRIX[role]?.[capability] ?? NONE;
}
