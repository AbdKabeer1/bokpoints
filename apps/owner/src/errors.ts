/**
 * The API's error codes in the words an owner needs when the portal
 * contradicts them. Anything unknown keeps its code visible, so a support
 * call can quote it. INVALID_RULE carries the engine's own message, which
 * is the report they need.
 */
const MESSAGES: Record<string, string> = {
  MISSING_TOKEN: 'You are signed out. Sign in again.',
  INVALID_TOKEN: 'Your sign-in has expired. Sign in again.',
  MFA_REQUIRED: 'Your sign-in needs its 6-digit code.',
  ACCOUNT_DEACTIVATED: 'This account has been deactivated. Contact OmaPointii support.',
  STORE_MISMATCH: 'You do not work at this store.',
  NOT_A_MEMBER: 'You do not work at this store.',
  FORBIDDEN: 'Your role does not allow that.',
  FORBIDDEN_ROLE: 'That role cannot be given here.',
  STORE_NOT_FOUND: 'That store does not exist here.',
  RULE_NOT_FOUND: 'That rule is not part of this store any more.',
  RULE_SUPERSEDED: 'That version is history; change the current rule instead.',
  RULES_EMPTY: 'This store has no rules to check against yet.',
  INVALID_RULE: 'The engine refused that rule.',
  NO_ACTIVE_RULE: 'The store is not awarding points: no rule is active.',
  ALREADY_MEMBER: 'That person already works at this store.',
  LOCATION_INVALID: 'That branch does not exist or is not open at this store.',
  BALANCE_WOULD_GO_NEGATIVE: 'That would take the balance below zero.',
  REVERSAL_NOT_ALLOWED:
    'Only the cashier who recorded the sale can reverse it in the first 15 minutes — you may reverse it as the owner or a manager.',
  REASON_REQUIRED: 'That action needs a reason.',
  SALE_NOT_FOUND: 'That sale is not in this store any more.',
  SALE_ALREADY_REVERSED: 'That sale was already reversed.',
  REWARD_NOT_FOUND: 'That reward is not part of this store any more.',
  REWARD_NOT_ACTIVE: 'That reward is not offered any more.',
  REWARD_NOT_AFFORDABLE: 'The customer does not have enough points for that reward.',
  REWARD_LIMIT_REACHED: 'The customer has already taken that reward today.',
  INVALID_AMOUNT: 'That amount is not a valid purchase amount.',
  CUSTOMER_NOT_FOUND: 'That customer does not exist any more.',
  LOGO_TOO_LARGE: 'That image is over 2 MB. Choose a smaller one.',
  LOGO_TYPE: 'Use a PNG, JPEG or WebP image.',
  LOGO_UPLOAD_FAILED: 'The image could not be stored. Try again.',
  LOGO_STORAGE_UNAVAILABLE: 'Image storage is not configured on this server.',
  below_minimum: 'The purchase is below that rule minimum.',
  condition_not_met: 'A rule condition was not met.',
};

export function ownerMessage(code: string): string {
  return MESSAGES[code] ?? `Something went wrong (${code}). Try again.`;
}
