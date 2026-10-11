// Pure rendering of the GitHub job summaries (no I/O). `summary.ts` reads the report files, parses them
// with the functions below and appends the rendered markdown to $GITHUB_STEP_SUMMARY.

export const COVERAGE_KEYS = ['statements', 'branches', 'functions', 'lines'] as const;
export type CoverageKey = (typeof COVERAGE_KEYS)[number];

export interface UnitTotals {
  total: number;
  failed: number;
  skipped: number;
}

export interface CoverageTotals {
  /** Percentage (0..100) per metric. */
  pct: Record<CoverageKey, number>;
}

export interface CrapTotals {
  max: number;
  functions: number;
  /** Functions scoring above `max`. */
  over: number;
}

/** Each part is `null` when its report file was not produced (an earlier step failed). */
export interface QualityInput {
  unit: UnitTotals | null;
  coverage: CoverageTotals | null;
  thresholds: Record<CoverageKey, number>;
  crap: CrapTotals | null;
}

export interface E2eCounts {
  passed: number;
  failed: number;
  skipped: number;
}

export interface E2eInput {
  /** e.g. `1/2` */
  shard: string;
  counts: E2eCounts | null;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const MISSING = '_no data: the report file was not produced_';

/** Reads the root `<testsuites tests=".." failures=".." errors=".." skipped="..">` element of a JUnit file. */
export function parseJunitTotals(xml: string): UnitTotals {
  const root = /<testsuites\b([^>]*)>/.exec(xml);
  if (!root) throw new Error('junit.xml has no <testsuites> element');
  const attr = (name: string): number => {
    const found = new RegExp(`\\b${name}="(\\d+)"`).exec(root[1]);
    return found ? Number(found[1]) : 0;
  };
  const total = attr('tests');
  const skipped = attr('skipped') || (xml.match(/<skipped\b/g) ?? []).length;
  return { total, failed: attr('failures') + attr('errors'), skipped };
}

/** Reads the `total` block of coverage-summary.json (istanbul json-summary shape). */
export function parseCoverageSummary(text: string): CoverageTotals {
  const total = (JSON.parse(text) as { total?: Partial<Record<CoverageKey, { pct?: unknown }>> }).total;
  if (!total) throw new Error('coverage-summary.json has no "total"');
  const pct = {} as Record<CoverageKey, number>;
  for (const key of COVERAGE_KEYS) pct[key] = num(total[key]?.pct);
  return { pct };
}

export function parseCrapSummary(text: string): CrapTotals {
  const raw = JSON.parse(text) as Partial<CrapTotals>;
  return { max: num(raw.max), functions: num(raw.functions), over: num(raw.over) };
}

/** Reads the `stats` block of a Playwright JSON report (`expected`/`unexpected`/`flaky`/`skipped`). */
export function parsePlaywrightCounts(text: string): E2eCounts {
  const stats = (JSON.parse(text) as { stats?: Record<string, unknown> }).stats;
  if (!stats) throw new Error('Playwright JSON report has no "stats"');
  return { passed: num(stats.expected) + num(stats.flaky), failed: num(stats.unexpected), skipped: num(stats.skipped) };
}

const mark = (ok: boolean): string => (ok ? '✅' : '❌');
const pct = (value: number): string => `${Math.round(value * 100) / 100}%`;

export function renderQualitySummary(input: QualityInput): string {
  const lines: string[] = ['## Quality', '', '### Unit tests', ''];
  if (input.unit) {
    const { total, failed, skipped } = input.unit;
    lines.push(`${mark(failed === 0)} ${total} tests: ${total - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
  } else {
    lines.push(MISSING);
  }
  lines.push('', '### Coverage', '');
  if (input.coverage) {
    lines.push('| Metric | Coverage | Threshold | |', '| --- | ---: | ---: | --- |');
    for (const key of COVERAGE_KEYS) {
      const value = input.coverage.pct[key];
      const threshold = input.thresholds[key];
      const ok = value >= threshold;
      lines.push(`| ${key} | ${pct(value)} | ${threshold}% | ${ok ? '✅ met' : `❌ miss (${pct(threshold - value)} below)`} |`);
    }
  } else {
    lines.push(MISSING);
  }
  lines.push('', '### CRAP', '');
  if (input.crap) {
    const { over, max, functions } = input.crap;
    lines.push(`${mark(over === 0)} ${over} function${over === 1 ? '' : 's'} over CRAP_MAX (${max}) of ${functions} scored`);
  } else {
    lines.push(MISSING);
  }
  return `${lines.join('\n')}\n`;
}

export function renderE2eSummary(input: E2eInput): string {
  const lines: string[] = [`## e2e shard ${input.shard}`, ''];
  if (input.counts) {
    const { passed, failed, skipped } = input.counts;
    lines.push(`${mark(failed === 0)} ${passed} passed, ${failed} failed, ${skipped} skipped`);
  } else {
    lines.push(MISSING);
  }
  return `${lines.join('\n')}\n`;
}
