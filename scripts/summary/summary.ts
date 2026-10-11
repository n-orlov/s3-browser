// `node scripts/summary/summary.ts quality` or `... e2e <i>/<n>`: reads the report files of the job that
// just ran and appends the markdown from jobSummary.ts to $GITHUB_STEP_SUMMARY (stdout when unset).
// Always exits 0 when the reports are missing: it runs in an `if: always()` step after a failed gate.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
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

function render(kind: string | undefined, shard: string | undefined): string {
  if (kind === 'quality') {
    const thresholds = load('vitest.config.ts', readCoverageThresholds);
    if (!thresholds) throw new Error('vitest.config.ts thresholds are unreadable');
    return renderQualitySummary({
      unit: load('junit/junit.xml', parseJunitTotals),
      coverage: load('coverage/coverage-summary.json', parseCoverageSummary),
      thresholds,
      crap: load('coverage/crap-summary.json', parseCrapSummary),
    });
  }
  if (kind === 'e2e' && shard) {
    return renderE2eSummary({ shard, counts: load('test-results/results.json', parsePlaywrightCounts) });
  }
  throw new Error('usage: summary.ts quality | summary.ts e2e <shard>');
}

try {
  const markdown = render(process.argv[2], process.argv[3]);
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (target) appendFileSync(target, markdown);
  else process.stdout.write(markdown);
} catch (error) {
  console.error(`summary: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
