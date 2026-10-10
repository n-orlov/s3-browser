// Runs the real `scripts/crap/crap.ts` CLI against a throwaway project so the gate semantics
// (exit codes, the baseline file, the shrink-only rule) are proven end to end.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.resolve(__dirname, '../..');
const cli = path.join(repo, 'scripts/crap/crap.ts');

// `risky` has complexity 6; with no covered statements its CRAP is 6^2 * 1 + 6 = 42. `safe` scores 1.
const source = [
  'export function risky(a: number): number {',
  '  if (a > 1) return 1;',
  '  if (a > 2) return 2;',
  '  if (a > 3) return 3;',
  '  if (a > 4) return 4;',
  '  if (a > 5) return 5;',
  '  return a;',
  '}',
  'export function safe(): number {',
  '  return 1;',
  '}',
  '',
].join('\n');

let dir: string;
const baselineFile = () => path.join(dir, 'crap-baseline.json');

function writeCoverage(riskyCovered: boolean): void {
  const file = path.join(dir, 'src/main/sample.ts');
  const statements = [2, 3, 4, 5, 6].map((line) => ({ start: { line, column: 2 }, end: { line, column: null } }));
  const coverage = {
    [file]: {
      fnMap: {
        '0': { loc: { start: { line: 1, column: source.split('\n')[0].length - 1 }, end: { line: 8, column: null } } },
        '1': { loc: { start: { line: 9, column: source.split('\n')[8].length - 1 }, end: { line: 11, column: null } } },
      },
      statementMap: { ...statements, '5': { start: { line: 10, column: 2 }, end: { line: 10, column: null } } },
      s: { '0': 0, '1': 0, '2': 0, '3': 0, '4': riskyCovered ? 1 : 0, '5': 1 },
      f: { '0': 0, '1': 1 },
    },
  };
  mkdirSync(path.join(dir, 'coverage'), { recursive: true });
  writeFileSync(path.join(dir, 'coverage/coverage-final.json'), JSON.stringify(coverage));
}

function run(args: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', cli, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CRAP_MAX: '', ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'crap-cli-'));
  mkdirSync(path.join(dir, 'src/main'), { recursive: true });
  writeFileSync(path.join(dir, 'src/main/sample.ts'), source);
  copyFileSync(path.join(repo, 'eslint.config.mjs'), path.join(dir, 'eslint.config.mjs'));
  symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'));
  writeCoverage(false);
}, 30_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('crap CLI', () => {
  it('prints each offending function with its score and exits non-zero without a baseline', () => {
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toContain('CRAP 42  src/main/sample.ts:risky');
    expect(out).not.toContain('sample.ts:safe');
  }, 30_000);

  it('--write-baseline lists exactly the functions over CRAP_MAX, and the gate then passes', () => {
    expect(run(['--write-baseline']).status).toBe(0);
    expect(JSON.parse(readFileSync(baselineFile(), 'utf8'))).toEqual({ 'src/main/sample.ts:risky': 42 });
    expect(run().status).toBe(0);
    expect(run(['--write-baseline'], { CRAP_MAX: '0.5' }).status).toBe(0);
    expect(Object.keys(JSON.parse(readFileSync(baselineFile(), 'utf8'))).sort()).toEqual([
      'src/main/sample.ts:risky',
      'src/main/sample.ts:safe',
    ]);
    run(['--write-baseline']);
  }, 60_000);

  it('fails for non-baselined functions over a lowered CRAP_MAX', () => {
    const { status, out } = run([], { CRAP_MAX: '0.5' });
    expect(status).toBe(1);
    expect(out).toContain('src/main/sample.ts:safe');
  }, 30_000);

  it('fails when a baseline entry is hand-lowered below the live score', () => {
    writeFileSync(baselineFile(), JSON.stringify({ 'src/main/sample.ts:risky': 41 }));
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toContain('worse than its baseline entry 41');
    writeFileSync(baselineFile(), JSON.stringify({ 'src/main/sample.ts:risky': 42 }));
  }, 30_000);

  it('passes once coverage improves a baselined function', () => {
    writeCoverage(true);
    const { status } = run();
    expect(status).toBe(0);
  }, 30_000);
});
