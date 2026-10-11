// Pure ratchet logic: the lint warning ceiling is fixed at 0 (and must be recorded as 0), the coverage thresholds only go up.
export const REQUIRED_MAX_WARNINGS = 0;
export const THRESHOLD_KEYS = ['lines', 'functions', 'branches', 'statements'] as const;
export type ThresholdKey = (typeof THRESHOLD_KEYS)[number];

export interface RatchetValues {
  maxWarnings: number;
  coverageThresholds: Record<ThresholdKey, number>;
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

/** Validates the parsed content of .ratchet.json. */
export function parseRatchet(text: string): RatchetValues {
  const raw = JSON.parse(text) as Partial<RatchetValues>;
  const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  if (!isNumber(raw.maxWarnings)) throw new Error('.ratchet.json needs a numeric "maxWarnings"');
  const thresholds = raw.coverageThresholds;
  if (typeof thresholds !== 'object' || thresholds === null) throw new Error('.ratchet.json needs "coverageThresholds"');
  const coverageThresholds = {} as Record<ThresholdKey, number>;
  for (const key of THRESHOLD_KEYS) {
    const value = (thresholds as Record<string, unknown>)[key];
    if (!isNumber(value)) throw new Error(`.ratchet.json coverageThresholds needs a numeric "${key}"`);
    coverageThresholds[key] = value;
  }
  return { maxWarnings: raw.maxWarnings, coverageThresholds };
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
  for (const key of THRESHOLD_KEYS) {
    if (current.coverageThresholds[key] < ratchet.coverageThresholds[key]) {
      violations.push(
        `coverage threshold ${key} is ${current.coverageThresholds[key]}, below the ratchet floor ${ratchet.coverageThresholds[key]}`,
      );
    }
  }
  return violations;
}

/** Returns one message per value that is now stricter than the ratchet and should be committed to it. */
export function findImprovements(ratchet: RatchetValues, current: RatchetValues): string[] {
  const notes: string[] = [];
  if (current.maxWarnings < ratchet.maxWarnings) notes.push(`maxWarnings ${ratchet.maxWarnings} -> ${current.maxWarnings}`);
  for (const key of THRESHOLD_KEYS) {
    if (current.coverageThresholds[key] > ratchet.coverageThresholds[key]) {
      notes.push(`${key} ${ratchet.coverageThresholds[key]} -> ${current.coverageThresholds[key]}`);
    }
  }
  return notes;
}
