// Pure per-module mutation check: Stryker's `thresholds.break` only judges the whole run, so every module of the closed set is scored on its own.
export interface MutantLike {
  status: string;
}
export interface MutationReportLike {
  files: Record<string, { mutants: MutantLike[] }>;
}
export interface ModuleScore {
  module: string;
  /** Mutation score in percent, or null when the report holds no scoreable mutant for the module. */
  score: number | null;
  detected: number;
  undetected: number;
}

const DETECTED = new Set(['Killed', 'Timeout']);
const UNDETECTED = new Set(['Survived', 'NoCoverage']);

const normalise = (file: string): string => file.replaceAll('\\', '/').replace(/^\.\//, '');

/** Scores one module the way Stryker does: (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage), as a percentage. */
export function scoreModule(report: MutationReportLike, module: string): ModuleScore {
  const wanted = normalise(module);
  const entry = Object.entries(report.files).find(([file]) => normalise(file) === wanted);
  let detected = 0;
  let undetected = 0;
  for (const mutant of entry?.[1].mutants ?? []) {
    if (DETECTED.has(mutant.status)) detected += 1;
    else if (UNDETECTED.has(mutant.status)) undetected += 1;
  }
  const total = detected + undetected;
  return { module, score: total === 0 ? null : (detected / total) * 100, detected, undetected };
}

export interface ModuleCheck {
  scores: ModuleScore[];
  /** One human-readable line per module that is missing from the report, has nothing to score, or scores below the break. */
  failures: string[];
}

/** Judges every module in `modules` against `breakThreshold`: a score below it fails, as does a module with no score at all. */
export function checkModules(report: MutationReportLike, modules: readonly string[], breakThreshold: number): ModuleCheck {
  const scores = modules.map((module) => scoreModule(report, module));
  const failures: string[] = [];
  for (const entry of scores) {
    if (entry.score === null) failures.push(`${entry.module}: no scoreable mutants in the report`);
    else if (entry.score < breakThreshold) {
      failures.push(`${entry.module}: ${entry.score.toFixed(2)}% is below the break of ${breakThreshold}%`);
    }
  }
  return { scores, failures };
}
