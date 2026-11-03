// Pure helpers shared by the Jenkins embeddable badges (`jenkins.ts`, `jenkinsBadges.ts`) and the README badge row
// (`readme.ts`, `readmeBlock.ts`): colours, the static package.json badges and the report-input parsers (no I/O).
import type { CoverageTotals, CrapTotals, E2eCounts, UnitTotals } from '../summary/jobSummary.ts';

export type BadgeColor = 'brightgreen' | 'green' | 'yellow' | 'orange' | 'red' | 'blue' | 'lightgrey';

export interface Badge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: BadgeColor;
}

/** Percentage points above its threshold at which a coverage or mutation badge turns green. */
export const GREEN_MARGIN = 5;

/** The `.ratchet.json` fields the badges read. */
export interface RatchetInput {
  maxWarnings: number;
  mutationScoreMin: number;
  coverageThresholds: { lines: number; functions: number; branches: number; statements: number };
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
}

const badge = (label: string, message: string, color: BadgeColor): Badge => ({ schemaVersion: 1, label, message, color });
const missing = (label: string): Badge => badge(label, 'n/a', 'lightgrey');

/** Below the threshold red, at it yellow, at threshold + GREEN_MARGIN or more green. */
export function colorForThreshold(value: number, threshold: number): BadgeColor {
  if (value < threshold) return 'red';
  return value >= threshold + GREEN_MARGIN ? 'brightgreen' : 'yellow';
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
