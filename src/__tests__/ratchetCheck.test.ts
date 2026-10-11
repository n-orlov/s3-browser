// The ratchet: lint --max-warnings and the crap-baseline.json size are fixed at 0 (recorded as 0 in .ratchet.json), coverage thresholds and the mutation break (recorded as at least 80) may only rise, versus .ratchet.json.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findImprovements,
  judgeRatchet,
  parseRatchet,
  readCoverageThresholds,
  readCrapBaselineSize,
  readLintCeiling,
  readMutationBreak,
  type RatchetValues,
} from '../../scripts/ratchet/ratchetCheck.ts';

const repo = path.resolve(__dirname, '../..');
const cli = path.join(repo, 'scripts/ratchet/ratchet.ts');

const base: RatchetValues = { maxWarnings: 0, crapBaselineMax: 0, mutationScoreMin: 80, coverageThresholds: { lines: 80, functions: 78, branches: 70, statements: 78 } };
const withThreshold = (key: keyof RatchetValues['coverageThresholds'], value: number): RatchetValues => ({
  ...base,
  coverageThresholds: { ...base.coverageThresholds, [key]: value },
});

describe('judgeRatchet', () => {
  it('passes when every value equals the ratchet', () => {
    expect(judgeRatchet(base, base)).toEqual([]);
  });

  it('fails when the warning ceiling is raised', () => {
    const violations = judgeRatchet(base, { ...base, maxWarnings: 1 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('is 1');
  });

  it('fails when .ratchet.json records a non-zero maxWarnings, even if the lint script matches it', () => {
    const loose = { ...base, maxWarnings: 3 };
    const violations = judgeRatchet(loose, loose);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('records maxWarnings 3');
    expect(judgeRatchet(loose, base)).toHaveLength(1);
  });

  it('fails when crap-baseline.json has more entries than crapBaselineMax', () => {
    const violations = judgeRatchet(base, { ...base, crapBaselineMax: 2 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('crap-baseline.json has 2 entries');
  });

  it('passes an empty crap-baseline.json against crapBaselineMax 0', () => {
    expect(judgeRatchet(base, { ...base, crapBaselineMax: 0 })).toEqual([]);
  });

  it('fails when .ratchet.json records a non-zero crapBaselineMax, even if the baseline matches it', () => {
    const loose = { ...base, crapBaselineMax: 3 };
    const violations = judgeRatchet(loose, loose);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('records crapBaselineMax 3');
  });

  it.each(['lines', 'functions', 'branches', 'statements'] as const)('fails when the %s threshold is lowered', (key) => {
    const violations = judgeRatchet(base, withThreshold(key, base.coverageThresholds[key] - 1));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(key);
  });

  it('fails when the Stryker break (79) is below the recorded mutationScoreMin (80)', () => {
    const violations = judgeRatchet(base, { ...base, mutationScoreMin: 79 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('thresholds.break is 79');
  });

  it('passes when the Stryker break (80) equals the recorded mutationScoreMin (80)', () => {
    expect(judgeRatchet(base, { ...base, mutationScoreMin: 80 })).toEqual([]);
  });

  it('fails when .ratchet.json records a mutationScoreMin below 80, even if the Stryker break matches it', () => {
    const loose = { ...base, mutationScoreMin: 79 };
    const violations = judgeRatchet(loose, loose);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('records mutationScoreMin 79');
  });

  it('reports a stricter Stryker break for tightening', () => {
    const improved = { ...base, mutationScoreMin: 85 };
    expect(judgeRatchet(base, improved)).toEqual([]);
    expect(findImprovements(base, improved)).toEqual(['mutationScoreMin 80 -> 85']);
  });

  it('reports a lowered warning ceiling and a smaller crap baseline for tightening, with the exact wording', () => {
    const loose = { ...base, maxWarnings: 3, crapBaselineMax: 2 };
    expect(findImprovements(loose, base)).toEqual(['maxWarnings 3 -> 0', 'crapBaselineMax 2 -> 0']);
    expect(findImprovements({ ...base, maxWarnings: 3 }, base)).toEqual(['maxWarnings 3 -> 0']);
    expect(findImprovements({ ...base, crapBaselineMax: 2 }, base)).toEqual(['crapBaselineMax 2 -> 0']);
    expect(findImprovements(base, { ...base, maxWarnings: 1, crapBaselineMax: 1 })).toEqual([]);
  });

  it('passes improved values and reports them for tightening', () => {
    const improved = withThreshold('lines', 85);
    expect(judgeRatchet(base, improved)).toEqual([]);
    expect(findImprovements(base, improved)).toEqual(['lines 80 -> 85']);
    expect(findImprovements(base, base)).toEqual([]);
  });

  it('reports every regression at once', () => {
    const worse = {
      maxWarnings: 2,
      crapBaselineMax: 1,
      mutationScoreMin: 1,
      coverageThresholds: { lines: 1, functions: 1, branches: 1, statements: 1 },
    };
    expect(judgeRatchet(base, worse)).toHaveLength(7);
  });
});

describe('readers', () => {
  it('reads --max-warnings from the lint script', () => {
    expect(readLintCeiling(JSON.stringify({ scripts: { lint: 'eslint . --max-warnings 7' } }))).toBe(7);
    expect(readLintCeiling(JSON.stringify({ scripts: { lint: 'eslint . --max-warnings=3 --quiet' } }))).toBe(3);
    expect(() => readLintCeiling(JSON.stringify({ scripts: { lint: 'eslint .' } }))).toThrow(/max-warnings/);
    expect(() => readLintCeiling(JSON.stringify({ scripts: {} }))).toThrow('package.json has no "lint" script');
    expect(() => readLintCeiling(JSON.stringify({}))).toThrow('package.json has no "lint" script');
    expect(() => readLintCeiling(JSON.stringify({ scripts: { lint: 5 } }))).toThrow('package.json has no "lint" script');
  });

  it('reads a multi-digit --max-warnings value separated by several spaces', () => {
    expect(readLintCeiling(JSON.stringify({ scripts: { lint: 'eslint .   --max-warnings   12' } }))).toBe(12);
    expect(readLintCeiling(JSON.stringify({ scripts: { lint: 'eslint . --max-warnings=345' } }))).toBe(345);
  });

  it('rejects a crap-baseline.json that is not a JSON object with the object message', () => {
    for (const text of ['null', '[]', '5', '"text"', 'true']) {
      expect(() => readCrapBaselineSize(text)).toThrow('crap-baseline.json must be a JSON object');
    }
  });

  it('tolerates whitespace around the colon of the thresholds block and of each key', () => {
    const coverage = 'thresholds \t:\n  { lines  :  81 , functions\t:79, branches :\n71.5, statements  :80 }';
    expect(readCoverageThresholds(coverage)).toEqual({ lines: 81, functions: 79, branches: 71.5, statements: 80 });
    expect(readCoverageThresholds('thresholds:{lines:1,functions:2,branches:3,statements:4}')).toEqual({
      lines: 1,
      functions: 2,
      branches: 3,
      statements: 4,
    });
    expect(readMutationBreak('thresholds \t:\n  { break  :  75 }')).toBe(75);
    expect(readMutationBreak('thresholds:{break:60.55}')).toBe(60.55);
    expect(readMutationBreak('thresholds:{ break\t:\n72.55 }')).toBe(72.55);
  });

  it('rejects non-finite and non-numeric ratchet values with the numeric-field message', () => {
    const text = (patch: Record<string, unknown>) => JSON.stringify({ ...base, ...patch }).replace('"__inf"', '1e999');
    expect(() => parseRatchet(text({ maxWarnings: '__inf' }))).toThrow('.ratchet.json needs a numeric "maxWarnings"');
    expect(() => parseRatchet(text({ crapBaselineMax: '__inf' }))).toThrow('.ratchet.json needs a numeric "crapBaselineMax"');
    expect(() => parseRatchet(text({ mutationScoreMin: '__inf' }))).toThrow('.ratchet.json needs a numeric "mutationScoreMin"');
    expect(() => parseRatchet(text({ maxWarnings: '0' }))).toThrow('.ratchet.json needs a numeric "maxWarnings"');
    expect(() => parseRatchet(text({ coverageThresholds: { ...base.coverageThresholds, lines: '__inf' } }))).toThrow(
      '.ratchet.json coverageThresholds needs a numeric "lines"',
    );
  });

  it('names the missing coverage threshold, and rejects a null or absent coverageThresholds', () => {
    for (const key of ['lines', 'functions', 'branches', 'statements'] as const) {
      const { [key]: _dropped, ...rest } = base.coverageThresholds;
      expect(() => parseRatchet(JSON.stringify({ ...base, coverageThresholds: rest }))).toThrow(
        `.ratchet.json coverageThresholds needs a numeric "${key}"`,
      );
      expect(() => parseRatchet(JSON.stringify({ ...base, coverageThresholds: { ...base.coverageThresholds, [key]: 'x' } }))).toThrow(
        `.ratchet.json coverageThresholds needs a numeric "${key}"`,
      );
    }
    expect(() => parseRatchet(JSON.stringify({ ...base, coverageThresholds: null }))).toThrow('.ratchet.json needs "coverageThresholds"');
    expect(() => parseRatchet(JSON.stringify({ ...base, coverageThresholds: 'x' }))).toThrow('.ratchet.json needs "coverageThresholds"');
  });

  it('counts the entries of crap-baseline.json', () => {
    expect(readCrapBaselineSize('{}')).toBe(0);
    expect(readCrapBaselineSize(JSON.stringify({ 'a.ts:f': 40, 'b.ts:g': 31 }))).toBe(2);
    expect(() => readCrapBaselineSize('[]')).toThrow(/object/);
    expect(() => readCrapBaselineSize('null')).toThrow(/object/);
  });

  it('reads the four coverage thresholds from vitest.config.ts', () => {
    const text = "coverage: { thresholds: {\n lines: 81,\n functions: 79,\n branches: 71.5,\n statements: 80,\n }, }";
    expect(readCoverageThresholds(text)).toEqual({ lines: 81, functions: 79, branches: 71.5, statements: 80 });
    expect(() => readCoverageThresholds('coverage: {}')).toThrow(/thresholds/);
    expect(() => readCoverageThresholds('thresholds: { lines: 1 }')).toThrow(/functions/);
  });

  it('reads thresholds.break from stryker.config.mjs', () => {
    expect(readMutationBreak('export default { thresholds: { high: 90, low: 85, break: 80 } };')).toBe(80);
    expect(readMutationBreak('// thresholds.break is 99\nexport default { thresholds:\n{ break: 72.5 } };')).toBe(72.5);
    expect(() => readMutationBreak('export default {};')).toThrow(/thresholds/);
    expect(() => readMutationBreak('export default { thresholds: { high: 90 } };')).toThrow(/break/);
  });

  it('rejects a malformed ratchet file', () => {
    expect(() => parseRatchet('{}')).toThrow(/maxWarnings/);
    expect(() => parseRatchet(JSON.stringify({ maxWarnings: 1 }))).toThrow(/crapBaselineMax/);
    expect(() => parseRatchet(JSON.stringify({ maxWarnings: 1, crapBaselineMax: 0 }))).toThrow(/mutationScoreMin/);
    expect(() => parseRatchet(JSON.stringify({ maxWarnings: 1, crapBaselineMax: 0, mutationScoreMin: 80 }))).toThrow(/coverageThresholds/);
    expect(parseRatchet(JSON.stringify(base))).toEqual(base);
  });
});

describe('ratchet:check CLI', () => {
  let dir: string;
  const writeProject = (current: RatchetValues, ratchet: RatchetValues = base) => {
    const t = current.coverageThresholds;
    writeFileSync(path.join(dir, '.ratchet.json'), JSON.stringify(ratchet));
    const baseline = Object.fromEntries(Array.from({ length: current.crapBaselineMax }, (_, i) => [`src/f${i}.ts:fn${i}`, 31 + i]));
    writeFileSync(path.join(dir, 'crap-baseline.json'), JSON.stringify(baseline));
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { lint: `eslint . --max-warnings ${current.maxWarnings}` } }),
    );
    writeFileSync(
      path.join(dir, 'stryker.config.mjs'),
      `export default { thresholds: { high: 90, low: 85, break: ${current.mutationScoreMin} } };\n`,
    );
    writeFileSync(
      path.join(dir, 'vitest.config.ts'),
      `export default { test: { coverage: { thresholds: { lines: ${t.lines}, functions: ${t.functions}, branches: ${t.branches}, statements: ${t.statements} } } } };\n`,
    );
  };
  const run = () => {
    const result = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', cli], {
      cwd: dir,
      encoding: 'utf8',
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ratchet-cli-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('exits 0 when the values equal the ratchet', () => {
    writeProject(base);
    expect(run().status).toBe(0);
  });

  it('exits non-zero when --max-warnings is raised', () => {
    writeProject({ ...base, maxWarnings: 1 });
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toContain('--max-warnings is 1');
  });

  it('exits 1 when .ratchet.json records a non-zero maxWarnings', () => {
    writeProject({ ...base, maxWarnings: 4 }, { ...base, maxWarnings: 4 });
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toContain('records maxWarnings 4');
  });

  it('exits 1 when crap-baseline.json has entries but crapBaselineMax is 0', () => {
    writeProject({ ...base, crapBaselineMax: 1 });
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toContain('crap-baseline.json has 1 entries');
  });

  it('exits 1 when .ratchet.json records a non-zero crapBaselineMax', () => {
    writeProject({ ...base, crapBaselineMax: 2 }, { ...base, crapBaselineMax: 2 });
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toContain('records crapBaselineMax 2');
  });

  it('exits 2 when crap-baseline.json is missing', () => {
    writeProject(base);
    rmSync(path.join(dir, 'crap-baseline.json'));
    expect(run().status).toBe(2);
  });

  it('exits non-zero when a vitest threshold is lowered', () => {
    writeProject(withThreshold('branches', 69));
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toContain('branches is 69');
  });

  it('exits 0 for improved values and says what to tighten', () => {
    writeProject(withThreshold('functions', 90));
    const { status, out } = run();
    expect(status).toBe(0);
    expect(out).toContain('functions 78 -> 90');
  });

  it('exits 1 when the Stryker break (79) is below mutationScoreMin (80)', () => {
    writeProject({ ...base, mutationScoreMin: 79 });
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toContain('thresholds.break is 79');
  });

  it('exits 0 when the Stryker break (80) equals mutationScoreMin (80)', () => {
    writeProject({ ...base, mutationScoreMin: 80 });
    expect(run().status).toBe(0);
  });

  it('exits 2 when .ratchet.json has no mutationScoreMin', () => {
    writeProject(base);
    const { mutationScoreMin: _omitted, ...withoutMutation } = base;
    writeFileSync(path.join(dir, '.ratchet.json'), JSON.stringify(withoutMutation));
    const { status, out } = run();
    expect(status).toBe(2);
    expect(out).toContain('mutationScoreMin');
  });

  it('exits 2 when stryker.config.mjs is missing', () => {
    writeProject(base);
    rmSync(path.join(dir, 'stryker.config.mjs'));
    expect(run().status).toBe(2);
  });

  it('exits 2 when .ratchet.json is missing', () => {
    writeProject(base);
    rmSync(path.join(dir, '.ratchet.json'));
    expect(run().status).toBe(2);
  });

  it('passes on the committed tree', () => {
    const result = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', cli], { cwd: repo, encoding: 'utf8' });
    expect(result.status).toBe(0);
    // The warning ceiling is recorded as 0; the floors may not move below the locked values.
    const committed = parseRatchet(readFileSync(path.join(repo, '.ratchet.json'), 'utf8'));
    const locked = { lines: 84, functions: 83, branches: 74, statements: 83 };
    for (const key of Object.keys(locked) as (keyof typeof locked)[]) {
      expect(committed.coverageThresholds[key]).toBeGreaterThanOrEqual(locked[key]);
    }
    expect(committed.maxWarnings).toBe(0);
    expect(committed.crapBaselineMax).toBe(0);
    expect(committed.mutationScoreMin).toBeGreaterThanOrEqual(80);
    expect(readCrapBaselineSize(readFileSync(path.join(repo, 'crap-baseline.json'), 'utf8'))).toBe(0);
  });

  it('keeps the vitest thresholds and the recorded floors equal, never below the prescribed branch level of 73', () => {
    const committed = parseRatchet(readFileSync(path.join(repo, '.ratchet.json'), 'utf8'));
    const enforced = readCoverageThresholds(readFileSync(path.join(repo, 'vitest.config.ts'), 'utf8'));
    expect(enforced).toEqual(committed.coverageThresholds);
    expect(enforced.branches).toBeGreaterThanOrEqual(73);
  });

  it('documents the enforced thresholds in SPEC.md', () => {
    const enforced = readCoverageThresholds(readFileSync(path.join(repo, 'vitest.config.ts'), 'utf8'));
    const spec = readFileSync(path.join(repo, 'SPEC.md'), 'utf8');
    const text = `lines ${enforced.lines}, functions ${enforced.functions}, branches ${enforced.branches}, statements ${enforced.statements}`;
    expect(spec).toContain(text);
  });
});
