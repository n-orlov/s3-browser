// CRAP gate: `npm run crap` (check) / `npm run crap -- --write-baseline` (regenerate the baseline).
// Run `npm run test:coverage` first; coverage comes from coverage/coverage-final.json.
import { ESLint } from 'eslint';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { toMetrics, type FileCoverage, type FunctionComplexity } from './crapReport.ts';
import { DEFAULT_CRAP_MAX, judgeCrap, scoreFunctions, type CrapBaseline, type FunctionMetrics } from './crapScore.ts';
import { functionRanges, type FunctionFacts } from './functionRanges.ts';

const root = process.cwd();
const COVERAGE_FILE = path.join(root, 'coverage', 'coverage-final.json');
const SUMMARY_FILE = path.join(root, 'coverage', 'crap-summary.json');
const BASELINE_FILE = path.join(root, 'crap-baseline.json');
const SOURCE_DIRS = ['src/main', 'src/preload', 'src/renderer', 'src/shared'];
const TEST_FILES = ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/*.d.ts'];

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function readMax(): number {
  const raw = process.env.CRAP_MAX;
  if (raw === undefined || raw === '') return DEFAULT_CRAP_MAX;
  const max = Number(raw);
  if (!Number.isFinite(max) || max < 0) fail(`CRAP_MAX must be a non-negative number, got "${raw}"`);
  return max;
}

async function collect(): Promise<FunctionMetrics[]> {
  if (!existsSync(COVERAGE_FILE)) fail('coverage/coverage-final.json is missing: run `npm run test:coverage` first.');
  const coverage = JSON.parse(readFileSync(COVERAGE_FILE, 'utf8')) as Record<string, FileCoverage>;
  const dirs = SOURCE_DIRS.filter((dir) => existsSync(path.join(root, dir)));
  const eslint = new ESLint({
    cwd: root,
    errorOnUnmatchedPattern: false,
    overrideConfig: [
      { ignores: TEST_FILES },
      {
        plugins: { crap: { rules: { 'function-ranges': functionRanges } } },
        rules: { complexity: ['warn', 0], 'crap/function-ranges': 'warn' },
      },
    ],
  });
  const results = await eslint.lintFiles(dirs);
  const metrics: FunctionMetrics[] = [];
  for (const result of results) {
    const file = path.relative(root, result.filePath).split(path.sep).join('/');
    const facts: FunctionFacts[] = [];
    const complexities = new Map<string, number>();
    for (const message of result.messages) {
      if (message.fatal) fail(`${file}: ${message.message}`);
      if (message.ruleId === 'crap/function-ranges') {
        facts.push(JSON.parse(message.message) as FunctionFacts);
      } else if (message.ruleId === 'complexity') {
        const found = /complexity of (\d+)/.exec(message.message);
        if (!found) fail(`${file}: unrecognised complexity message "${message.message}"`);
        complexities.set(`${message.line}:${message.column - 1}`, Number(found[1]));
      }
    }
    facts.sort((a, b) => a.headLine - b.headLine || a.headColumn - b.headColumn);
    const functions: FunctionComplexity[] = facts.map((fact) => {
      const complexity = complexities.get(`${fact.headLine}:${fact.headColumn}`);
      if (complexity === undefined) fail(`${file}:${fact.headLine}: no complexity reported for ${fact.name}`);
      return { name: fact.name, complexity, bodyLine: fact.bodyLine, bodyColumn: fact.bodyColumn };
    });
    metrics.push(...toMetrics(file, functions, coverage[result.filePath]));
  }
  return metrics;
}

function format(score: number): string {
  return (Math.round(score * 100) / 100).toString();
}

function readBaseline(): CrapBaseline {
  if (!existsSync(BASELINE_FILE)) return {};
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as CrapBaseline;
}

/** Machine-readable totals for the CI job summary (scripts/summary). Written before the verdict so a red gate keeps it. */
function writeSummary(max: number, metrics: readonly FunctionMetrics[]): void {
  const over = scoreFunctions(metrics).filter((fn) => fn.crap > max).length;
  mkdirSync(path.dirname(SUMMARY_FILE), { recursive: true });
  writeFileSync(SUMMARY_FILE, `${JSON.stringify({ max, functions: metrics.length, over })}\n`);
}

async function main(): Promise<void> {
  const max = readMax();
  const metrics = await collect();
  if (process.argv.includes('--write-baseline')) {
    const over = scoreFunctions(metrics)
      .filter((fn) => fn.crap > max)
      .sort((a, b) => a.id.localeCompare(b.id));
    // Written with full precision so an unchanged function never reads as worse than its entry.
    const baseline = Object.fromEntries(over.map((fn) => [fn.id, fn.crap]));
    writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Wrote ${over.length} function(s) over CRAP ${max} to crap-baseline.json`);
    return;
  }
  writeSummary(max, metrics);
  const baseline = readBaseline();
  const verdict = judgeCrap(metrics, { max, baseline });
  const byScore = [...verdict.violations].sort((a, b) => b.crap - a.crap);
  for (const violation of byScore) {
    const why =
      violation.reason === 'over-limit'
        ? `over the limit ${format(violation.limit)}`
        : `worse than its baseline entry ${format(violation.limit)}`;
    console.error(`CRAP ${format(violation.crap)}  ${violation.id}  (${why})`);
  }
  const live = new Set(metrics.map((fn) => fn.id));
  const stale = Object.keys(baseline).filter((id) => !live.has(id));
  if (stale.length > 0) {
    console.log(`${stale.length} baseline entr${stale.length === 1 ? 'y' : 'ies'} no longer match a function: regenerate with \`npm run crap -- --write-baseline\`.`);
  }
  if (!verdict.ok) {
    console.error(`${verdict.violations.length} function(s) fail the CRAP gate (max ${max}; the baseline may only shrink).`);
    process.exit(1);
  }
  console.log(`CRAP gate passed: ${metrics.length} functions, max ${max}, ${Object.keys(baseline).length} baselined.`);
}

await main();
