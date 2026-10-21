import { describe, expect, it } from 'vitest';
import { can } from './permissions.js';

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
