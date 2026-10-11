// Pure ratchet logic: the lint warning ceiling and the CRAP baseline size are fixed at 0 (and must be recorded as 0), the coverage thresholds and the mutation break only go up (the break is recorded as at least 80).
export const REQUIRED_MAX_WARNINGS = 0;
export const REQUIRED_CRAP_BASELINE_MAX = 0;
export const REQUIRED_MUTATION_SCORE_MIN = 80;
export const THRESHOLD_KEYS = ['lines', 'functions', 'branches', 'statements'] as const;
export type ThresholdKey = (typeof THRESHOLD_KEYS)[number];

export interface RatchetValues {
  maxWarnings: number;
  /** In .ratchet.json: the allowed number of crap-baseline.json entries. In the current values: the actual number of entries. */
  crapBaselineMax: number;
  coverageThresholds: Record<ThresholdKey, number>;
  /** In .ratchet.json: the mutation score floor. In the current values: `thresholds.break` of stryker.config.mjs. */
  mutationScoreMin: number;
}

/** Reads the `--max-warnings N` value of the `lint` script out of package.json text. */
export function readLintCeiling(packageJsonText: string): number {
  const scripts = (JSON.parse(packageJsonText) as { scripts?: Record<string, string> }).scripts ?? {};
  const lint = scripts.lint;
  if (typeof lint !== 'string') throw new Error('package.json has no "lint" script');
  const found = /--max-warnings(?:=|\s+)(\d+)/.exec(lint);
  if (!found) throw new Error(`the "lint" script has no --max-warnings value: ${lint}`);
  return Number(found[1]);
}

/** Reads the number of entries in the text of crap-baseline.json. */
export function readCrapBaselineSize(crapBaselineText: string): number {
  const parsed: unknown = JSON.parse(crapBaselineText);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('crap-baseline.json must be a JSON object');
  }
  return Object.keys(parsed).length;
}

/** Reads the four coverage thresholds out of the text of vitest.config.ts. */
export function readCoverageThresholds(vitestConfigText: string): Record<ThresholdKey, number> {
  const block = /\bthresholds\s*:\s*\{([^}]*)\}/.exec(vitestConfigText);
  if (!block) throw new Error('vitest.config.ts has no coverage "thresholds" block');
  const result = {} as Record<ThresholdKey, number>;
  for (const key of THRESHOLD_KEYS) {
    const found = new RegExp(`\\b${key}\\s*:\\s*(\\d+(?:\\.\\d+)?)`).exec(block[1]);
    if (!found) throw new Error(`vitest.config.ts thresholds has no "${key}" value`);
    result[key] = Number(found[1]);
  }
  return result;
}

/** Reads `thresholds.break` out of the text of stryker.config.mjs. */
export function readMutationBreak(strykerConfigText: string): number {
  const block = /\bthresholds\s*:\s*\{([^}]*)\}/.exec(strykerConfigText);
  if (!block) throw new Error('stryker.config.mjs has no "thresholds" block');
  const found = /\bbreak\s*:\s*(\d+(?:\.\d+)?)/.exec(block[1]);
  if (!found) throw new Error('stryker.config.mjs thresholds has no "break" value');
  return Number(found[1]);
}

/** Validates the parsed content of .ratchet.json. */
export function parseRatchet(text: string): RatchetValues {
  const raw = JSON.parse(text) as Partial<RatchetValues>;
  const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  if (!isNumber(raw.maxWarnings)) throw new Error('.ratchet.json needs a numeric "maxWarnings"');
  if (!isNumber(raw.crapBaselineMax)) throw new Error('.ratchet.json needs a numeric "crapBaselineMax"');
  if (!isNumber(raw.mutationScoreMin)) throw new Error('.ratchet.json needs a numeric "mutationScoreMin"');
  const thresholds = raw.coverageThresholds;
  if (typeof thresholds !== 'object' || thresholds === null) throw new Error('.ratchet.json needs "coverageThresholds"');
  const coverageThresholds = {} as Record<ThresholdKey, number>;
  for (const key of THRESHOLD_KEYS) {
    const value = (thresholds as Record<string, unknown>)[key];
    if (!isNumber(value)) throw new Error(`.ratchet.json coverageThresholds needs a numeric "${key}"`);
    coverageThresholds[key] = value;
  }
  return { maxWarnings: raw.maxWarnings, crapBaselineMax: raw.crapBaselineMax, coverageThresholds, mutationScoreMin: raw.mutationScoreMin };
}

/** Returns one message per regression; an empty list means the ratchet holds. */
export function judgeRatchet(ratchet: RatchetValues, current: RatchetValues): string[] {
  const violations: string[] = [];
  if (ratchet.maxWarnings !== REQUIRED_MAX_WARNINGS) {
    violations.push(`.ratchet.json records maxWarnings ${ratchet.maxWarnings}; the lint gate requires ${REQUIRED_MAX_WARNINGS}`);
  }
  if (current.maxWarnings > ratchet.maxWarnings) {
    violations.push(`lint --max-warnings is ${current.maxWarnings}, above the ratchet ceiling ${ratchet.maxWarnings}`);
  }
  if (ratchet.crapBaselineMax !== REQUIRED_CRAP_BASELINE_MAX) {
    violations.push(
      `.ratchet.json records crapBaselineMax ${ratchet.crapBaselineMax}; the CRAP gate requires ${REQUIRED_CRAP_BASELINE_MAX}`,
    );
  }
  if (current.crapBaselineMax > ratchet.crapBaselineMax) {
    violations.push(`crap-baseline.json has ${current.crapBaselineMax} entries, above the ratchet ceiling ${ratchet.crapBaselineMax}`);
  }
  for (const key of THRESHOLD_KEYS) {
    if (current.coverageThresholds[key] < ratchet.coverageThresholds[key]) {
      violations.push(
        `coverage threshold ${key} is ${current.coverageThresholds[key]}, below the ratchet floor ${ratchet.coverageThresholds[key]}`,
      );
    }
  }
  if (ratchet.mutationScoreMin < REQUIRED_MUTATION_SCORE_MIN) {
    violations.push(
      `.ratchet.json records mutationScoreMin ${ratchet.mutationScoreMin}; the mutation gate requires at least ${REQUIRED_MUTATION_SCORE_MIN}`,
    );
  }
  if (current.mutationScoreMin < ratchet.mutationScoreMin) {
    violations.push(
      `mutation thresholds.break is ${current.mutationScoreMin}, below the ratchet floor ${ratchet.mutationScoreMin}`,
    );
  }
  return violations;
}

/** Returns one message per value that is now stricter than the ratchet and should be committed to it. */
export function findImprovements(ratchet: RatchetValues, current: RatchetValues): string[] {
  const notes: string[] = [];
  if (current.maxWarnings < ratchet.maxWarnings) notes.push(`maxWarnings ${ratchet.maxWarnings} -> ${current.maxWarnings}`);
  if (current.crapBaselineMax < ratchet.crapBaselineMax) {
    notes.push(`crapBaselineMax ${ratchet.crapBaselineMax} -> ${current.crapBaselineMax}`);
  }
  for (const key of THRESHOLD_KEYS) {
    if (current.coverageThresholds[key] > ratchet.coverageThresholds[key]) {
      notes.push(`${key} ${ratchet.coverageThresholds[key]} -> ${current.coverageThresholds[key]}`);
    }
  }
  if (current.mutationScoreMin > ratchet.mutationScoreMin) {
    notes.push(`mutationScoreMin ${ratchet.mutationScoreMin} -> ${current.mutationScoreMin}`);
  }
  return notes;
}
