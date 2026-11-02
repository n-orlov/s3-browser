// Coverage floors: vitest.config.ts, .ratchet.json and the SPEC.md section 4 text state the same four numbers, each the measured total (rounded down) minus 1.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseRatchet, readCoverageThresholds, THRESHOLD_KEYS } from '../../scripts/ratchet/ratchetCheck.ts';

const repo = path.resolve(__dirname, '../..');
const EXPECTED = { lines: 92, functions: 89, branches: 83, statements: 90 };

/** The four numbers SPEC.md states in the `test:coverage` row of section 4: "lines N, functions N, branches N, statements N". */
function specThresholds(specText: string): Record<string, number> {
  const found = /thresholds in `vitest\.config\.ts` are lines (\d+), functions (\d+), branches (\d+), statements (\d+)/.exec(specText);
  if (!found) throw new Error('SPEC.md does not state the four coverage thresholds');
  return { lines: Number(found[1]), functions: Number(found[2]), branches: Number(found[3]), statements: Number(found[4]) };
}

const vitestText = readFileSync(path.join(repo, 'vitest.config.ts'), 'utf8');
const specText = readFileSync(path.join(repo, 'SPEC.md'), 'utf8');

describe('coverage floors', () => {
  it('has vitest.config.ts thresholds at the floors (measured total, rounded down, minus 1)', () => {
    expect(readCoverageThresholds(vitestText)).toEqual(EXPECTED);
  });

  it('has .ratchet.json coverageThresholds at the same floors', () => {
    const ratchet = parseRatchet(readFileSync(path.join(repo, '.ratchet.json'), 'utf8'));
    expect(ratchet.coverageThresholds).toEqual(EXPECTED);
  });

  it('has SPEC.md section 4 state the numbers vitest.config.ts has', () => {
    expect(specThresholds(specText)).toEqual(readCoverageThresholds(vitestText));
  });

  it('is red for a SPEC text whose numbers differ from vitest.config.ts', () => {
    const drifted = specText.replace('branches 83,', 'branches 74,');
    expect(drifted).not.toBe(specText);
    expect(specThresholds(drifted)).not.toEqual(readCoverageThresholds(vitestText));
  });

  it('is red for the previous floors 84/83/74/83', () => {
    const old = vitestText.replace(/thresholds:\s*\{[^}]*\}/, 'thresholds: { lines: 84, functions: 83, branches: 74, statements: 83 }');
    expect(readCoverageThresholds(old)).not.toEqual(EXPECTED);
    expect(Object.keys(EXPECTED)).toEqual([...THRESHOLD_KEYS]);
  });
});
