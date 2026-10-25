import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = [
  'apps/customer/dist',
  'apps/web/dist',
  'apps/owner/dist',
  'apps/admin/dist',
];

// `sb_secret_` appears in the supabase-js key-format code itself, so the
// check looks for server-only variable names in the built output instead.
const forbidden = [
  { label: 'SUPABASE_SECRET_KEY', pattern: /SUPABASE_SECRET_KEY/ },
  { label: 'SUPABASE_SERVICE_ROLE_KEY', pattern: /SUPABASE_SERVICE_ROLE_KEY/ },
];

const files = [];
for (const root of roots) {
  if (!existsSync(root)) continue;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(root);
}

const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) hits.push(`${rule.label}: ${file}`);
  }
}

if (hits.length > 0) {
  console.error('Secret-like material found in a built bundle:');
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}

console.warn(`Checked ${files.length} built files; no secret-like material found.`);
