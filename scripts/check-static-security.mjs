import { readFileSync } from 'node:fs';

const configs = [
  'apps/customer/vercel.json',
  'apps/web/vercel.json',
  'apps/owner/vercel.json',
  'apps/admin/vercel.json',
];

const requiredHeaders = [
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
];

const failures = [];

for (const path of configs) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const rules = Array.isArray(config.headers) ? config.headers : [];
  const entries = rules.flatMap((rule) => (Array.isArray(rule.headers) ? rule.headers : []));
  const headers = new Map(
    entries.map(({ key, value }) => [String(key).toLowerCase(), String(value)]),
  );

  for (const header of requiredHeaders) {
    if (!headers.has(header)) failures.push(`${path}: missing ${header}`);
  }
  if (headers.has('content-security-policy-report-only')) {
    failures.push(`${path}: CSP is report-only`);
  }

  const csp = headers.get('content-security-policy') ?? '';
  for (const directive of [
    "frame-ancestors 'none'",
    'https://api.omapointii.store',
    'https://*.supabase.co',
    'https://*.ingest.sentry.io',
  ]) {
    if (!csp.includes(directive)) failures.push(`${path}: CSP missing ${directive}`);
  }

  if (headers.get('x-frame-options') !== 'DENY') {
    failures.push(`${path}: X-Frame-Options must be DENY`);
  }
  if (headers.get('x-content-type-options') !== 'nosniff') {
    failures.push(`${path}: X-Content-Type-Options must be nosniff`);
  }
}

if (failures.length > 0) {
  console.error('Static security configuration check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Checked ${configs.length} Vercel security configurations.`);
