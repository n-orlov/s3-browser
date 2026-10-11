// Pure rendering of the shields.io endpoint badges (no I/O). `render.ts` reads the report files, calls
// `renderBadges` and writes one `<name>.json` per badge; the inputs are the ones the job summary uses.
import type { CoverageTotals, CrapTotals, E2eCounts, UnitTotals } from '../summary/jobSummary.ts';

export type BadgeColor = 'brightgreen' | 'green' | 'yellow' | 'orange' | 'red' | 'blue' | 'lightgrey';

export interface Badge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: BadgeColor;
}

export const BADGE_NAMES = [
  'coverage-lines',
  'coverage-branches',
  'coverage-functions',
  'coverage-statements',
  'crap',
  'lint',
  'unit-tests',
  'e2e-tests',
  'mutation',
  'audit',
] as const;
export type BadgeName = (typeof BADGE_NAMES)[number];

/** Percentage points above its threshold at which a coverage or mutation badge turns green. */
export const GREEN_MARGIN = 5;

/** The `.ratchet.json` fields the badges read. */
export interface RatchetInput {
  maxWarnings: number;
  mutationScoreMin: number;
  coverageThresholds: { lines: number; functions: number; branches: number; statements: number };
}

/** npm audit's `metadata.vulnerabilities` block. */
export interface AuditCounts {
  info: number;
  low: number;
  moderate: number;
  high: number;
  critical: number;
  total: number;
}

/** Totals of an ESLint JSON result (`eslint --format json`). */
export interface LintCounts {
  errors: number;
  warnings: number;
}

/** Each part is `null` when its input was not produced. */
export interface BadgeInput {
  ratchet: RatchetInput | null;
  /** ESLint's own result: the warning and error counts of the last lint run, not the configured ceiling. */
  lint: LintCounts | null;
  coverage: CoverageTotals | null;
  crap: CrapTotals | null;
  unit: UnitTotals | null;
  /** Summed over the e2e shards. */
  e2e: E2eCounts | null;
  /** Mutation score in percent over the whole report. */
  mutation: number | null;
  audit: AuditCounts | null;
}

const badge = (label: string, message: string, color: BadgeColor): Badge => ({ schemaVersion: 1, label, message, color });
const missing = (label: string): Badge => badge(label, 'n/a', 'lightgrey');
const round = (value: number): number => Math.round(value * 100) / 100;

/** Below the threshold red, at it yellow, at threshold + GREEN_MARGIN or more green. */
export function colorForThreshold(value: number, threshold: number): BadgeColor {
  if (value < threshold) return 'red';
  return value >= threshold + GREEN_MARGIN ? 'brightgreen' : 'yellow';
}

function coverageBadge(key: keyof RatchetInput['coverageThresholds'], input: BadgeInput): Badge {
  const label = `coverage ${key}`;
  if (!input.coverage || !input.ratchet) return missing(label);
  const value = input.coverage.pct[key];
  return badge(label, `${round(value)}%`, colorForThreshold(value, input.ratchet.coverageThresholds[key]));
}

function crapBadge(crap: CrapTotals | null): Badge {
  if (!crap) return missing('crap');
  return badge('crap', `${crap.over} over ${crap.max}`, crap.over === 0 ? 'brightgreen' : 'red');
}

/** Green only at zero warnings and zero errors; errors are red, warnings alone yellow. */
function lintBadge(lint: LintCounts | null): Badge {
  if (!lint) return missing('lint');
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
  const message = lint.errors > 0 ? `${plural(lint.errors, 'error')}, ${plural(lint.warnings, 'warning')}` : plural(lint.warnings, 'warning');
  const color: BadgeColor = lint.errors > 0 ? 'red' : lint.warnings > 0 ? 'yellow' : 'brightgreen';
  return badge('lint', message, color);
}

/** Red on any failure: a failed test or (e2e) a report-level error such as a global setup throw, which leaves every stat at zero. */
function testsBadge(label: string, counts: { passed: number; failed: number; skipped: number; errors?: number } | null): Badge {
  if (!counts) return missing(label);
  const errors = counts.errors ?? 0;
  const skipped = counts.skipped > 0 ? `, ${counts.skipped} skipped` : '';
  const failures = [
    ...(counts.failed > 0 ? [`${counts.failed} failed`] : []),
    ...(errors > 0 ? [`${errors} report error${errors === 1 ? '' : 's'}`] : []),
  ];
  const message = failures.length > 0 ? `${failures.join(', ')}, ${counts.passed} passed${skipped}` : `${counts.passed} passed${skipped}`;
  return badge(label, message, failures.length === 0 ? 'brightgreen' : 'red');
}

function mutationBadge(score: number | null, ratchet: RatchetInput | null): Badge {
  if (score === null || !ratchet) return missing('mutation');
  return badge('mutation', `${round(score)}%`, colorForThreshold(score, ratchet.mutationScoreMin));
}

/** The gate is high+ (`audit:prod`): the count is high plus critical, green only at zero, red otherwise; low and moderate findings never show. */
function auditBadge(audit: AuditCounts | null): Badge {
  if (!audit) return missing('audit');
  const serious = audit.high + audit.critical;
  return badge('audit', `${serious} high+ vulnerabilit${serious === 1 ? 'y' : 'ies'}`, serious === 0 ? 'brightgreen' : 'red');
}

/** All ten endpoint badges, keyed by file stem. */
export function renderBadges(input: BadgeInput): Record<BadgeName, Badge> {
  return {
    'coverage-lines': coverageBadge('lines', input),
    'coverage-branches': coverageBadge('branches', input),
    'coverage-functions': coverageBadge('functions', input),
    'coverage-statements': coverageBadge('statements', input),
    crap: crapBadge(input.crap),
    lint: lintBadge(input.lint),
    'unit-tests': testsBadge('unit tests', input.unit && { passed: input.unit.total - input.unit.failed - input.unit.skipped, ...input.unit }),
    'e2e-tests': testsBadge('e2e tests', input.e2e),
    mutation: mutationBadge(input.mutation, input.ratchet),
    audit: auditBadge(input.audit),
  };
}

/** Static badges whose values come from package.json (never hard-coded). */
export function staticBadges(pkg: unknown): { license: Badge; electron: Badge; node: Badge } {
  const raw = (pkg ?? {}) as {
    license?: unknown;
    devDependencies?: Record<string, unknown>;
    engines?: Record<string, unknown>;
  };
  const major = (range: unknown): string | null => {
    const found = typeof range === 'string' ? /\d+/.exec(range) : null;
    return found ? found[0] : null;
  };
  const pick = (label: string, message: string | null, color: BadgeColor): Badge =>
    message ? badge(label, message, color) : missing(label);
  return {
    license: pick('license', typeof raw.license === 'string' && raw.license ? raw.license : null, 'blue'),
    electron: pick('electron', major(raw.devDependencies?.electron), 'blue'),
    node: pick('node', major(raw.engines?.node), 'blue'),
  };
}

/** Whole-report mutation score in percent, as Stryker computes it, or null when nothing is scoreable. */
export function mutationScoreOf(report: { files: Record<string, { mutants: { status: string }[] }> }): number | null {
  let detected = 0;
  let undetected = 0;
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') detected += 1;
      else if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') undetected += 1;
    }
  }
  return detected + undetected === 0 ? null : (detected / (detected + undetected)) * 100;
}

const num = (value: unknown): number => (Number.isFinite(value) ? (value as number) : 0);

/** Reads the `metadata.vulnerabilities` block of `npm audit --json`. */
export function parseAuditCounts(text: string): AuditCounts {
  const block = (JSON.parse(text) as { metadata?: { vulnerabilities?: Record<string, unknown> } }).metadata?.vulnerabilities;
  if (!block) throw new Error('audit JSON has no metadata.vulnerabilities');
  const counts = { info: num(block.info), low: num(block.low), moderate: num(block.moderate), high: num(block.high), critical: num(block.critical) };
  return { ...counts, total: counts.info + counts.low + counts.moderate + counts.high + counts.critical };
}

/** Reads the fields of `.ratchet.json` the badges use. */
export function parseRatchetInput(text: string): RatchetInput {
  const raw = JSON.parse(text) as Partial<RatchetInput> | null;
  const thresholds = raw?.coverageThresholds;
  if (!raw || !thresholds) throw new Error('.ratchet.json has no coverageThresholds');
  return {
    maxWarnings: num(raw.maxWarnings),
    mutationScoreMin: num(raw.mutationScoreMin),
    coverageThresholds: {
      lines: num(thresholds.lines),
      functions: num(thresholds.functions),
      branches: num(thresholds.branches),
      statements: num(thresholds.statements),
    },
  };
}

/** Sums `errorCount` and `warningCount` over the files of an `eslint --format json` result. */
export function parseEslintCounts(text: string): LintCounts {
  const results: unknown = JSON.parse(text);
  if (!Array.isArray(results)) throw new Error('ESLint JSON is not an array of file results');
  let errors = 0;
  let warnings = 0;
  for (const entry of results as { errorCount?: unknown; fatalErrorCount?: unknown; warningCount?: unknown }[]) {
    if (!entry || typeof entry !== 'object' || !Number.isFinite(entry.errorCount) || !Number.isFinite(entry.warningCount)) {
      throw new Error('ESLint JSON entry has no errorCount/warningCount');
    }
    errors += entry.errorCount as number;
    warnings += entry.warningCount as number;
  }
  return { errors, warnings };
}
