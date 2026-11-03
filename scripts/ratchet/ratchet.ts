// Ratchet gate: `npm run ratchet:check` fails when the lint --max-warnings ceiling rose or a vitest
// coverage threshold or the Stryker mutation break (stryker.config.mjs) fell, or crap-baseline.json holds more entries than allowed, or the CRAP limit (DEFAULT_CRAP_MAX) rose, relative to .ratchet.json,
// and when any of those values is looser than at `git merge-base HEAD origin/master` (exit 2 when there is no merge base). Run from the repository root.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BASE_REF,
  findImprovements,
  judgeAgainstBase,
  judgeRatchet,
  parseRatchet,
  readBaseValues,
  readCoverageThresholds,
  readCrapBaselineSize,
  readCrapMax,
  readLintCeiling,
  readMutationBreak,
} from './ratchetCheck.ts';

const root = process.cwd();
const read = (name: string): string => readFileSync(path.join(root, name), 'utf8');

const git = (...args: string[]): { status: number | null; stdout: string } => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? '' };
};

try {
  const ratchet = parseRatchet(read('.ratchet.json'));
  const current = {
    maxWarnings: readLintCeiling(read('package.json')),
    crapBaselineMax: readCrapBaselineSize(read('crap-baseline.json')),
    crapMax: readCrapMax(read('scripts/crap/crapScore.ts')),
    coverageThresholds: readCoverageThresholds(read('vitest.config.ts')),
    mutationScoreMin: readMutationBreak(read('stryker.config.mjs')),
  };
  const mergeBase = git('merge-base', 'HEAD', BASE_REF);
  const baseSha = mergeBase.stdout.trim();
  if (mergeBase.status !== 0 || baseSha === '') throw new Error(`no merge base of HEAD and ${BASE_REF}; fetch ${BASE_REF} first`);
  const readAtBase = (file: string): string | undefined => {
    const shown = git('show', `${baseSha}:${file}`);
    return shown.status === 0 ? shown.stdout : undefined;
  };
  const violations = [...judgeRatchet(ratchet, current), ...judgeAgainstBase(readBaseValues(readAtBase), current)];
  for (const violation of violations) console.error(`RATCHET ${violation}`);
  if (violations.length > 0) process.exit(1);
  const improvements = findImprovements(ratchet, current);
  if (improvements.length > 0) console.log(`ratchet: tighten .ratchet.json to lock in: ${improvements.join(', ')}`);
  console.log('ratchet: ok');
} catch (error) {
  console.error(`ratchet: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
