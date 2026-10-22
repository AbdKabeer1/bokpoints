/**
 * True when the error is a Postgres unique violation (23505). Drizzle wraps
 * the driver error, so the cause chain is walked.
 */
export function isUniqueViolation(error: unknown): boolean {
  let cursor: unknown = error;
  while (cursor instanceof Error) {
    if ((cursor as { code?: unknown }).code === '23505') return true;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}
