// Ratchet gate: `npm run ratchet:check` fails when the lint --max-warnings ceiling rose or a vitest
// coverage threshold fell relative to .ratchet.json. Run from the repository root.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findImprovements, judgeRatchet, parseRatchet, readCoverageThresholds, readLintCeiling } from './ratchetCheck.ts';

const root = process.cwd();
const read = (name: string): string => readFileSync(path.join(root, name), 'utf8');

try {
  const ratchet = parseRatchet(read('.ratchet.json'));
  const current = {
    maxWarnings: readLintCeiling(read('package.json')),
    coverageThresholds: readCoverageThresholds(read('vitest.config.ts')),
  };
  const violations = judgeRatchet(ratchet, current);
  for (const violation of violations) console.error(`RATCHET ${violation}`);
  if (violations.length > 0) process.exit(1);
  const improvements = findImprovements(ratchet, current);
  if (improvements.length > 0) console.log(`ratchet: tighten .ratchet.json to lock in: ${improvements.join(', ')}`);
  console.log('ratchet: ok');
} catch (error) {
  console.error(`ratchet: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
