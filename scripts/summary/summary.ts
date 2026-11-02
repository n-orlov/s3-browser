// `node scripts/summary/summary.ts html [dir]` writes the CI summary page (`<dir>/index.html`, default
// `ci-summary`) from the unit, coverage, CRAP and flaky-count files and every `e2e-<i>/test-results/results.json`.
// `node scripts/summary/summary.ts quality` or `... e2e <i>/<n>`: reads the report files of the job that
// just ran and appends the markdown from jobSummary.ts to $GITHUB_STEP_SUMMARY (stdout when unset).
// Always exits 0 when the reports are missing: it runs in an `if: always()` step after a failed gate.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readCoverageThresholds } from '../ratchet/ratchetCheck.ts';
import {
  parseCoverageSummary,
  parseCrapSummary,
  parseJunitTotals,
  parsePlaywrightCounts,
  renderE2eSummary,
  renderQualitySummary,
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

/** Quality-job inputs shared by the markdown summary and the HTML page. */
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

function render(kind: string | undefined, shard: string | undefined): string {
  if (kind === 'quality') {
    return renderQualitySummary(readQuality());
  }
  if (kind === 'e2e' && shard) {
    return renderE2eSummary({ shard, counts: load('test-results/results.json', parsePlaywrightCounts) });
  }
  throw new Error('usage: summary.ts quality | summary.ts e2e <shard> | summary.ts html [dir]');
}

try {
  if (process.argv[2] === 'html') {
    writePage(process.argv[3] ?? 'ci-summary');
    process.exit(0);
  }
  const markdown = render(process.argv[2], process.argv[3]);
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (target) appendFileSync(target, markdown);
  else process.stdout.write(markdown);
} catch (error) {
  console.error(`summary: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
