import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Tests always run against the shared package source, never a stale build.
 * The alias has to be repeated in each project: a root-level `resolve` does
 * not propagate into inline project configs.
 */
const sharedAlias = {
  '@bokpoints/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
};

export default defineConfig({
  test: {
    // The projects start empty and fill up as the build lands.
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias: sharedAlias },
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias: sharedAlias },
        test: {
          name: 'integration',
          include: ['apps/*/test/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
