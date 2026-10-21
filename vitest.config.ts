import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The projects start empty and fill up as the build lands.
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
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
