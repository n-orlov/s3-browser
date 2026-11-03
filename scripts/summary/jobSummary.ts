// Pure parsers for the CI report files (no I/O) and the helpers the CI summary page shares. `summary.ts` reads the
// files, parses them with the functions below and `summaryPage.ts` renders the page.

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
  /** Report-level failures (the top-level `errors` array: a global setup/teardown throw, a worker crash, no tests found). */
  errors: number;
}

export interface E2eInput {
  /** e.g. `1/2` */
  shard: string;
  counts: E2eCounts | null;
}

const num = (value: unknown): number => (Number.isFinite(value) ? (value as number) : 0);

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

/**
 * Reads the `stats` block of a Playwright JSON report (`expected`/`unexpected`/`flaky`/`skipped`) and the length
 * of its top-level `errors` array. A run that fails before or outside any test (global setup, global teardown)
 * has all-zero stats and only that array, so `errors` is what keeps it from reading as a pass.
 */
export function parsePlaywrightCounts(text: string): E2eCounts {
  const report = JSON.parse(text) as { stats?: Record<string, unknown>; errors?: unknown };
  const stats = report.stats;
  if (!stats) throw new Error('Playwright JSON report has no "stats"');
  const errors = Array.isArray(report.errors) ? report.errors.length : 0;
  return { passed: num(stats.expected) + num(stats.flaky), failed: num(stats.unexpected), skipped: num(stats.skipped), errors };
}

/** True when the counts hold any failure: a failed test or a report-level error. */
export const e2eHasFailure = (counts: E2eCounts): boolean => counts.failed > 0 || counts.errors > 0;

export const mark = (ok: boolean): string => (ok ? '✅' : '❌');
export const pct = (value: number): string => `${Math.round(value * 100) / 100}%`;
