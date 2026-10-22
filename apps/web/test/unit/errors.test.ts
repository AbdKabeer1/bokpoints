import { describe, expect, it } from 'vitest';
import { cashierMessage } from '../../src/errors';

describe('cashierMessage', () => {
  it('turns known API codes into sentences the till understands', () => {
    expect(cashierMessage('CREDENTIAL_NOT_FOUND')).toMatch(/not a member card/i);
    expect(cashierMessage('below_minimum')).toMatch(/below the minimum/i);
    expect(cashierMessage('STORE_NOT_AWARDING')).toMatch(/cannot award/i);
    expect(cashierMessage('ACCOUNT_DEACTIVATED')).toMatch(/deactivated/i);
  });

  it('names the code when it does not know it', () => {
    expect(cashierMessage('WEIRD_THING')).toContain('WEIRD_THING');
  });
});
