// The ratchet: lint --max-warnings may only fall, coverage thresholds may only rise, versus .ratchet.json.
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
  readLintCeiling,
  type RatchetValues,
} from '../../scripts/ratchet/ratchetCheck.ts';

const repo = path.resolve(__dirname, '../..');
const cli = path.join(repo, 'scripts/ratchet/ratchet.ts');

const base: RatchetValues = { maxWarnings: 18, coverageThresholds: { lines: 80, functions: 78, branches: 70, statements: 78 } };
const withThreshold = (key: keyof RatchetValues['coverageThresholds'], value: number): RatchetValues => ({
  ...base,
  coverageThresholds: { ...base.coverageThresholds, [key]: value },
});

describe('judgeRatchet', () => {
  it('passes when every value equals the ratchet', () => {
    expect(judgeRatchet(base, base)).toEqual([]);
  });

  it('fails when the warning ceiling is raised', () => {
    const violations = judgeRatchet(base, { ...base, maxWarnings: 19 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('19');
  });

  it.each(['lines', 'functions', 'branches', 'statements'] as const)('fails when the %s threshold is lowered', (key) => {
    const violations = judgeRatchet(base, withThreshold(key, base.coverageThresholds[key] - 1));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(key);
  });

  it('passes improved values and reports them for tightening', () => {
    const improved = { ...withThreshold('lines', 85), maxWarnings: 10 };
    expect(judgeRatchet(base, improved)).toEqual([]);
    expect(findImprovements(base, improved)).toEqual(['maxWarnings 18 -> 10', 'lines 80 -> 85']);
    expect(findImprovements(base, base)).toEqual([]);
  });

  it('reports every regression at once', () => {
    const worse = { maxWarnings: 20, coverageThresholds: { lines: 1, functions: 1, branches: 1, statements: 1 } };
    expect(judgeRatchet(base, worse)).toHaveLength(5);
  });
});

describe('readers', () => {
  it('reads --max-warnings from the lint script', () => {
    expect(readLintCeiling(JSON.stringify({ scripts: { lint: 'eslint . --max-warnings 7' } }))).toBe(7);
    expect(readLintCeiling(JSON.stringify({ scripts: { lint: 'eslint . --max-warnings=3 --quiet' } }))).toBe(3);
    expect(() => readLintCeiling(JSON.stringify({ scripts: { lint: 'eslint .' } }))).toThrow(/max-warnings/);
    expect(() => readLintCeiling(JSON.stringify({ scripts: {} }))).toThrow(/lint/);
  });

  it('reads the four coverage thresholds from vitest.config.ts', () => {
    const text = "coverage: { thresholds: {\n lines: 81,\n functions: 79,\n branches: 71.5,\n statements: 80,\n }, }";
    expect(readCoverageThresholds(text)).toEqual({ lines: 81, functions: 79, branches: 71.5, statements: 80 });
    expect(() => readCoverageThresholds('coverage: {}')).toThrow(/thresholds/);
    expect(() => readCoverageThresholds('thresholds: { lines: 1 }')).toThrow(/functions/);
  });

  it('rejects a malformed ratchet file', () => {
    expect(() => parseRatchet('{}')).toThrow(/maxWarnings/);
    expect(() => parseRatchet(JSON.stringify({ maxWarnings: 1 }))).toThrow(/coverageThresholds/);
    expect(parseRatchet(JSON.stringify(base))).toEqual(base);
  });
});

describe('ratchet:check CLI', () => {
  let dir: string;
  const writeProject = (current: RatchetValues, ratchet: RatchetValues = base) => {
    const t = current.coverageThresholds;
    writeFileSync(path.join(dir, '.ratchet.json'), JSON.stringify(ratchet));
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { lint: `eslint . --max-warnings ${current.maxWarnings}` } }),
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
    writeProject({ ...base, maxWarnings: 19 });
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toContain('--max-warnings is 19');
  });

  it('exits non-zero when a vitest threshold is lowered', () => {
    writeProject(withThreshold('branches', 69));
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toContain('branches is 69');
  });

  it('exits 0 for improved values and says what to tighten', () => {
    writeProject({ ...withThreshold('functions', 90), maxWarnings: 5 });
    const { status, out } = run();
    expect(status).toBe(0);
    expect(out).toContain('maxWarnings 18 -> 5');
    expect(out).toContain('functions 78 -> 90');
  });

  it('exits 2 when .ratchet.json is missing', () => {
    writeProject(base);
    rmSync(path.join(dir, '.ratchet.json'));
    expect(run().status).toBe(2);
  });

  it('passes on the committed tree', () => {
    const result = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', cli], { cwd: repo, encoding: 'utf8' });
    expect(result.status).toBe(0);
    // The warning ceiling only ratchets down (each lint fix lowers it), so it may sit below `base`; the floors may not.
    const committed = parseRatchet(readFileSync(path.join(repo, '.ratchet.json'), 'utf8'));
    expect(committed.coverageThresholds).toEqual(base.coverageThresholds);
    expect(Number.isInteger(committed.maxWarnings)).toBe(true);
    expect(committed.maxWarnings).toBeGreaterThanOrEqual(0);
    expect(committed.maxWarnings).toBeLessThanOrEqual(base.maxWarnings);
  });
});
