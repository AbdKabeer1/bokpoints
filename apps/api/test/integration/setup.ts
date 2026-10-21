import { applyMigrations, truncateAll } from '../../src/db/migrate.js';

/**
 * The migration helpers live in `src/db/migrate.ts` so the demo script and
 * the integration tests build their database the same way.
 */
export { applyMigrations, truncateAll };
