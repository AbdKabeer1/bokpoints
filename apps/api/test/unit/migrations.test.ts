import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');

/**
 * `drizzle-kit migrate` only runs the migrations listed in the journal. The
 * test helper runs every .sql file it finds, so a migration that is missing
 * from the journal passes every test and is then silently skipped on a real
 * database. This test closes that gap.
 */
describe('migration journal', () => {
  const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };

  it('lists exactly the migration files that exist', () => {
    const files = readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.replace(/\.sql$/, ''))
      .sort();
    const listed = journal.entries.map((entry) => entry.tag).sort();

    expect(listed).toEqual(files);
  });

  it('numbers the entries in order, with no gaps or repeats', () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it('has a snapshot for every entry, so the next generate diffs correctly', () => {
    for (const entry of journal.entries) {
      const snapshot = `meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`;
      expect(existsSync(join(dir, snapshot)), snapshot).toBe(true);
    }
  });
});
