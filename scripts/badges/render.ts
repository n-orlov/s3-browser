// `npm run badges -- --out <dir>`: reads the report files the job summary reads (plus the mutation report, the
// npm audit JSON and .ratchet.json) and writes one shields.io endpoint JSON file per badge into <dir>.
// Options: --e2e <file> (repeatable, Playwright JSON per shard; default test-results/results.json),
// --mutation <file> (default reports/mutation/mutation.json), --audit <file> (default reports/audit.json),
// --eslint <file> (ESLint `--format json` output, default reports/eslint.json).
// A missing or unreadable input yields an `n/a` badge, never a failure. Run from the repository root.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  mutationScoreOf,
  parseAuditCounts,
  parseEslintCounts,
  parseRatchetInput,
  renderBadges,
  type BadgeInput,
} from './badges.ts';
import {
  parseCoverageSummary,
  parseCrapSummary,
  parseJunitTotals,
  parsePlaywrightCounts,
  type E2eCounts,
} from '../summary/jobSummary.ts';

const root = process.cwd();

/** Parsed content of a report file, or null when the file is absent or unreadable. */
function load<T>(file: string, parse: (text: string) => T): T | null {
  const full = path.resolve(root, file);
  if (!existsSync(full)) return null;
  try {
    return parse(readFileSync(full, 'utf8'));
  } catch (error) {
    console.error(`badges: ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function sumE2e(files: string[]): E2eCounts | null {
  const counts = files.map((file) => load(file, parsePlaywrightCounts));
  if (counts.length === 0 || counts.some((entry) => entry === null)) return null;
  const all = counts as E2eCounts[];
  return {
    passed: all.reduce((sum, entry) => sum + entry.passed, 0),
    failed: all.reduce((sum, entry) => sum + entry.failed, 0),
    skipped: all.reduce((sum, entry) => sum + entry.skipped, 0),
  };
}

try {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      e2e: { type: 'string', multiple: true },
      mutation: { type: 'string' },
      audit: { type: 'string' },
      eslint: { type: 'string' },
    },
  });
  if (!values.out) throw new Error('usage: badges.ts --out <dir> [--e2e <file>]... [--mutation <file>] [--audit <file>] [--eslint <file>]');
  const input: BadgeInput = {
    ratchet: load('.ratchet.json', parseRatchetInput),
    lint: load(values.eslint ?? 'reports/eslint.json', parseEslintCounts),
    coverage: load('coverage/coverage-summary.json', parseCoverageSummary),
    crap: load('coverage/crap-summary.json', parseCrapSummary),
    unit: load('junit/junit.xml', parseJunitTotals),
    e2e: sumE2e(values.e2e ?? ['test-results/results.json']),
    mutation: load(values.mutation ?? 'reports/mutation/mutation.json', (text) =>
      mutationScoreOf(JSON.parse(text) as Parameters<typeof mutationScoreOf>[0]),
    ),
    audit: load(values.audit ?? 'reports/audit.json', parseAuditCounts),
  };
  const out = path.resolve(root, values.out);
  mkdirSync(out, { recursive: true });
  for (const [name, badge] of Object.entries(renderBadges(input))) {
    writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(badge, null, 2)}\n`);
  }
  console.log(`badges: wrote 10 endpoint files to ${values.out}`);
} catch (error) {
  console.error(`badges: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
