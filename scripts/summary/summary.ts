// `node scripts/summary/summary.ts html [dir]` writes the CI summary page (`<dir>/index.html`, default
// `ci-summary`) from the unit, coverage, CRAP and flaky-count files and every `e2e-<i>/test-results/results.json`.
// Always exits 0 when the reports are missing: it runs in a post step after a failed gate.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readCoverageThresholds } from '../ratchet/ratchetCheck.ts';
import {
  parseCoverageSummary,
  parseCrapSummary,
  parseJunitTotals,
  parsePlaywrightCounts,
} from './jobSummary.ts';
import { parseFlakyCount, renderSummaryPage } from './summaryPage.ts';

const root = process.cwd();

/** Parsed content of a report file, or null when the file is absent or unreadable. */
function load<T>(file: string, parse: (text: string) => T): T | null {
  const full = path.join(root, file);
  if (!existsSync(full)) return null;
  try {
    return parse(readFileSync(full, 'utf8'));
  } catch (error) {
    console.error(`summary: ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Quality-job inputs of the HTML page. */
function readQuality() {
  const thresholds = load('vitest.config.ts', readCoverageThresholds);
  if (!thresholds) throw new Error('vitest.config.ts thresholds are unreadable');
  return {
    unit: load('junit/junit.xml', parseJunitTotals),
    coverage: load('coverage/coverage-summary.json', parseCoverageSummary),
    thresholds,
    crap: load('coverage/crap-summary.json', parseCrapSummary),
  };
}

/** Writes the CI summary page; the e2e shards are the `e2e-<i>` directories the post step unstashed. */
function writePage(dir: string): void {
  const shardDirs = readdirSync(root).filter((name) => /^e2e-\d+$/.test(name)).sort();
  const e2e = shardDirs.map((name) => ({
    shard: name.slice('e2e-'.length),
    counts: load(`${name}/test-results/results.json`, parsePlaywrightCounts),
  }));
  const html = renderSummaryPage({ quality: readQuality(), e2e, flaky: load('reports/flaky-count.txt', parseFlakyCount) });
  mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, dir, 'index.html'), html);
}

try {
  if (process.argv[2] === 'html') {
    writePage(process.argv[3] ?? 'ci-summary');
    process.exit(0);
  }
  throw new Error('usage: summary.ts html [dir]');
} catch (error) {
  console.error(`summary: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
