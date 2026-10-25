/**
 * API codes in words an operator can act on. Anything unknown falls back to
 * a sentence that names the next step rather than the code.
 */
const MESSAGES: Record<string, string> = {
  STORE_NOT_FOUND: 'That store no longer exists. Go back to the store list.',
  FORBIDDEN: 'Your admin account does not have this permission.',
  MISSING_TOKEN: 'Your session ended. Sign in again.',
  INVALID_TOKEN: 'Your session ended. Sign in again.',
  MFA_REQUIRED: 'The second factor is needed before this action.',
  MFA_STEP_UP_REQUIRED:
    'Sign in again with your authenticator before this action. The previous check is too old.',
  ACCOUNT_DEACTIVATED: 'This account has been deactivated.',
  RATE_LIMIT: 'Too many requests just now. Wait a moment and try again.',
  INVALID_RESPONSE: 'The API sent an answer this console did not understand.',
};

export function adminMessage(code: string): string {
  return MESSAGES[code] ?? 'That did not work. Try again, then check the audit log.';
}
