// `npm run badges:ci -- <out file>`: reads the report files of the build (with the
// e2e results of every `e2e-<i>/test-results/results.json` shard) and writes `<id>=<status>|<color>` lines for the
// Jenkins embeddable badges tests, coverage, quality and mutation. A missing report reads as `not run`; never fails
// for missing input. Run from the repository root.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mutationScoreOf, parseEslintCounts, parseRatchetInput } from './badges.ts';
import { jenkinsBadges, renderBadgeLines } from './jenkinsBadges.ts';
import { parseCoverageSummary, parseCrapSummary, parseJunitTotals, parsePlaywrightCounts, type E2eCounts } from '../summary/jobSummary.ts';

const root = process.cwd();

function load<T>(file: string, parse: (text: string) => T): T | null {
  const full = path.resolve(root, file);
  if (!existsSync(full)) return null;
  try {
    return parse(readFileSync(full, 'utf8'));
  } catch (error) {
    console.error(`badges:ci: ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Summed over the shard directories that exist and parse; no shard result at all is null. */
function sumE2e(): E2eCounts | null {
  const shards = readdirSync(root).filter((name) => /^e2e-\d+$/.test(name)).sort();
  const counts = shards.map((name) => load(`${name}/test-results/results.json`, parsePlaywrightCounts)).filter((entry): entry is E2eCounts => entry !== null);
  if (counts.length === 0) return null;
  const sum = (key: keyof E2eCounts): number => counts.reduce((total, entry) => total + entry[key], 0);
  return { passed: sum('passed'), failed: sum('failed'), skipped: sum('skipped'), errors: sum('errors') };
}

try {
  const out = process.argv[2];
  if (!out) throw new Error('usage: jenkins.ts <out file>');
  const badges = jenkinsBadges({
    ratchet: load('.ratchet.json', parseRatchetInput),
    lint: load('reports/eslint.json', parseEslintCounts),
    coverage: load('coverage/coverage-summary.json', parseCoverageSummary),
    crap: load('coverage/crap-summary.json', parseCrapSummary),
    unit: load('junit/junit.xml', parseJunitTotals),
    e2e: sumE2e(),
    mutation: load('reports/mutation/mutation.json', (text) => mutationScoreOf(JSON.parse(text) as Parameters<typeof mutationScoreOf>[0])),
  });
  mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true });
  writeFileSync(path.resolve(root, out), renderBadgeLines(badges));
} catch (error) {
  console.error(`badges:ci: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
