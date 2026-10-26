import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const localEnv = (() => {
  try {
    const text = readFileSync(resolve(repoRoot, '.env.local'), 'utf8');
    const values: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      values[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, '');
    }
    return values;
  } catch {
    return {};
  }
})();

process.env.SENTRY_URL = process.env.SENTRY_URL ?? localEnv.SENTRY_URL;
const uploadSourcemaps = (process.env.SENTRY_UPLOAD_SOURCEMAPS ?? localEnv.SENTRY_UPLOAD_SOURCEMAPS) === '1';

const sentryPlugin = (() => {
  const authToken = process.env.SENTRY_AUTH_TOKEN ?? localEnv.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG ?? localEnv.SENTRY_ORG;
  const project = localEnv.SENTRY_PROJECT_ADMIN;
  if (!uploadSourcemaps || !authToken || !org || !project) return null;
  return sentryVitePlugin({
    org,
    project,
    authToken,
    ...(process.env.SENTRY_URL ? { url: process.env.SENTRY_URL } : {}),
    telemetry: false,
    sourcemaps: { assets: './dist', filesToDeleteAfterUpload: ['./dist/**/*.map'] },
  });
})();

/** The admin console talks to the API through this proxy in development. */
export default defineConfig({
  plugins: [react(), ...(sentryPlugin ? [sentryPlugin] : [])],
  build: { sourcemap: uploadSourcemaps },
  server: {
    host: true,
    strictPort: true,
    port: 5175,
    proxy: {
      '/v1': 'http://127.0.0.1:3000',
    },
  },
});
