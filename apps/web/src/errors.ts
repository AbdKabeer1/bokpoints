/**
 * The API's error codes in the words a cashier needs at the till. Anything
 * unknown keeps its code visible, so a phone call can quote it.
 */
const MESSAGES: Record<string, string> = {
  MISSING_TOKEN: 'You are signed out. Sign in again.',
  INVALID_TOKEN: 'Your sign-in has expired. Sign in again.',
  MFA_REQUIRED: 'Your sign-in needs its 6-digit code.',
  ACCOUNT_DEACTIVATED: 'This account has been deactivated. Ask the owner.',
  STORE_MISMATCH: 'You do not work at this store.',
  NOT_A_MEMBER: 'You do not work at this store.',
  FORBIDDEN: 'Your role does not allow that.',
  FORBIDDEN_ROLE: 'That role cannot be given here.',
  CUSTOMER_NOT_FOUND: 'That code is not recognised. Scan it again, or register them without the app.',
  CREDENTIAL_NOT_FOUND: 'That code is not a member card. Scan it again, or check the code.',
  STORE_NOT_AWARDING: 'This store cannot award points right now. Ask the owner.',
  NO_ACTIVE_RULE: 'This store has no points rule yet. Ask the owner.',
  RULES_EMPTY: 'This store has no points rule yet. Ask the owner.',
  LOCATION_REQUIRED: 'This store needs a branch on the award.',
  LOCATION_INVALID: 'That branch is not open any more.',
  LOCATION_MISMATCH: 'You are limited to a different branch.',
  INVALID_AMOUNT: 'That amount is not a valid purchase amount.',
  below_minimum: 'Purchase is below the minimum, so it earns no points.',
  condition_not_met: 'A rule condition was not met, so it earns no points.',
  BALANCE_WOULD_GO_NEGATIVE: 'That would take the balance below zero.',
  IDEMPOTENCY_KEY_REUSED: 'This purchase was already recorded with a different amount.',
  RATE_LIMITED: 'Too many tries. Wait a minute, then try again.',
};

export function cashierMessage(code: string): string {
  return MESSAGES[code] ?? `Something went wrong (${code}). Try again.`;
}

/** Shown under the till card, so a stuck cashier knows who to ask. */
export const HELP_LINE = 'Stuck? Ask the store owner — support contacts are on the owner portal.';
