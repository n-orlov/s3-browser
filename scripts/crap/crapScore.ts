// Pure CRAP (Change Risk Anti-Patterns) scoring. No I/O: the CLI feeds it
// per-function complexity and coverage and acts on the verdict.

export const DEFAULT_CRAP_MAX = 30;

/** Scores are compared with this slack so a baseline written from a rounded score still passes. */
const SCORE_EPSILON = 1e-6;

export interface FunctionMetrics {
  /** Stable identity, e.g. `src/main/foo.ts:bar`. */
  id: string;
  /** Cyclomatic complexity as reported by ESLint's `complexity` rule. */
  complexity: number;
  /** Fraction of the function covered, 0..1. */
  coverage: number;
}

export interface ScoredFunction extends FunctionMetrics {
  crap: number;
}

export type CrapBaseline = Readonly<Record<string, number>>;

export interface CrapViolation {
  id: string;
  crap: number;
  /** `over-limit`: not baselined and above the limit. `worse-than-baseline`: baselined and above its entry. */
  reason: 'over-limit' | 'worse-than-baseline';
  /** The limit (over-limit) or the baseline entry (worse-than-baseline) that was exceeded. */
  limit: number;
}

export interface CrapVerdict {
  ok: boolean;
  violations: CrapViolation[];
}

/** CRAP = c^2 * (1 - cov)^3 + c */
export function crapScore(complexity: number, coverage: number): number {
  if (!Number.isFinite(complexity) || complexity < 0) {
    throw new RangeError(`complexity must be a non-negative number, got ${complexity}`);
  }
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
    throw new RangeError(`coverage must be a fraction between 0 and 1, got ${coverage}`);
  }
  return complexity ** 2 * (1 - coverage) ** 3 + complexity;
}

export function scoreFunctions(functions: readonly FunctionMetrics[]): ScoredFunction[] {
  return functions.map((fn) => ({ ...fn, crap: crapScore(fn.complexity, fn.coverage) }));
}

/**
 * A baselined function fails when it scores above its baseline entry (the baseline may only
 * shrink); any other function fails when it scores above `max`. Baseline entries for functions
 * that no longer exist are ignored.
 */
export function judgeCrap(
  functions: readonly FunctionMetrics[],
  options: { max?: number; baseline?: CrapBaseline } = {},
): CrapVerdict {
  const max = options.max ?? DEFAULT_CRAP_MAX;
  const baseline = options.baseline ?? {};
  const violations: CrapViolation[] = [];
  for (const fn of scoreFunctions(functions)) {
    const entry = Object.hasOwn(baseline, fn.id) ? baseline[fn.id] : undefined;
    if (entry !== undefined) {
      if (fn.crap > entry + SCORE_EPSILON) {
        violations.push({ id: fn.id, crap: fn.crap, reason: 'worse-than-baseline', limit: entry });
      }
    } else if (fn.crap > max + SCORE_EPSILON) {
      violations.push({ id: fn.id, crap: fn.crap, reason: 'over-limit', limit: max });
    }
  }
  return { ok: violations.length === 0, violations };
}
