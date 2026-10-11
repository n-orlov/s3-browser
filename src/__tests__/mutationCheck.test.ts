// The per-module mutation check: every module of the closed set must reach thresholds.break on its own, not just the run as a whole.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkModules, scoreModule, type MutationReportLike } from '../../scripts/mutation/mutationCheck.ts';

const repo = path.resolve(__dirname, '../..');
const MODULES = [
  'scripts/crap/crapScore.ts',
  'scripts/ratchet/ratchetCheck.ts',
  'scripts/summary/jobSummary.ts',
  'src/main/ipc/validate.ts',
  'src/main/externalUrlPolicy.ts',
  'src/main/windowSecurity.ts',
  'src/main/services/s3Url.ts',
  'src/main/services/gzipUtils.ts',
];

/** A module whose mutants are `killed` Killed and `survived` Survived, plus noise statuses that must not count. */
function fileWith(killed: number, survived: number) {
  const status = [
    ...Array<string>(killed).fill('Killed'),
    ...Array<string>(survived).fill('Survived'),
    'CompileError',
    'Ignored',
    'RuntimeError',
  ];
  return { mutants: status.map((s) => ({ status: s })) };
}
const report = (perModule: Record<string, [number, number]>): MutationReportLike => ({
  files: Object.fromEntries(Object.entries(perModule).map(([file, [k, s]]) => [file, fileWith(k, s)])),
});
const allAt = (killed: number, survived: number): Record<string, [number, number]> =>
  Object.fromEntries(MODULES.map((m) => [m, [killed, survived] as [number, number]]));

describe('scoreModule', () => {
  it('scores (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage) and ignores compile errors, runtime errors and ignored mutants', () => {
    const r: MutationReportLike = {
      files: { 'a.ts': { mutants: ['Killed', 'Timeout', 'Survived', 'NoCoverage', 'CompileError', 'Ignored', 'RuntimeError'].map((status) => ({ status })) } },
    };
    expect(scoreModule(r, 'a.ts')).toEqual({ module: 'a.ts', score: 50, detected: 2, undetected: 2 });
  });

  it('matches report paths regardless of a leading ./ or backslashes', () => {
    const r: MutationReportLike = { files: { '.\\src\\a.ts': { mutants: [{ status: 'Killed' }] } } };
    expect(scoreModule(r, 'src/a.ts').score).toBe(100);
  });

  it('gives a null score to a module that is absent or has no scoreable mutant', () => {
    expect(scoreModule({ files: {} }, 'a.ts').score).toBeNull();
    expect(scoreModule({ files: { 'a.ts': { mutants: [{ status: 'Ignored' }] } } }, 'a.ts').score).toBeNull();
  });
});

describe('checkModules', () => {
  it('fails a report in which one module of the set scores 79 percent and every other module is perfect', () => {
    const perModule = allAt(10, 0);
    perModule['src/main/windowSecurity.ts'] = [79, 21];
    const { failures } = checkModules(report(perModule), MODULES, 80);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('src/main/windowSecurity.ts');
    expect(failures[0]).toContain('79.00%');
  });

  it('passes a report in which all 8 modules of the set score 80 percent or more', () => {
    const perModule = allAt(80, 20);
    perModule['src/main/ipc/validate.ts'] = [100, 0];
    const { failures, scores } = checkModules(report(perModule), MODULES, 80);
    expect(failures).toEqual([]);
    expect(scores).toHaveLength(8);
    expect(scores.map((s) => s.module)).toEqual(MODULES);
  });

  it('fails a module that is missing from the report, so a shrunken run cannot pass', () => {
    const perModule = allAt(10, 0);
    delete perModule['src/main/services/gzipUtils.ts'];
    const { failures } = checkModules(report(perModule), MODULES, 80);
    expect(failures).toEqual(['src/main/services/gzipUtils.ts: no scoreable mutants in the report']);
  });

  it('reports every failing module, not just the first', () => {
    const perModule = allAt(10, 0);
    perModule['scripts/crap/crapScore.ts'] = [1, 1];
    perModule['src/main/services/s3Url.ts'] = [0, 5];
    expect(checkModules(report(perModule), MODULES, 80).failures).toHaveLength(2);
  });
});

describe('stryker.config.mjs', () => {
  it('mutates exactly the closed set of 8 modules, breaks at 80 and writes HTML and JSON reports to reports/mutation/', async () => {
    const config = (await import(path.join(repo, 'stryker.config.mjs'))) as {
      default: { mutate: string[]; thresholds: { break: number }; reporters: string[]; testRunner: string; htmlReporter: { fileName: string }; jsonReporter: { fileName: string } };
    };
    expect([...config.default.mutate].sort()).toEqual([...MODULES].sort());
    expect(config.default.thresholds.break).toBe(80);
    expect(config.default.testRunner).toBe('vitest-file');
    expect(config.default.reporters).toEqual(expect.arrayContaining(['html', 'json']));
    expect(config.default.htmlReporter.fileName).toBe('reports/mutation/mutation.html');
    expect(config.default.jsonReporter.fileName).toBe('reports/mutation/mutation.json');
  });

  it('keeps reports/ out of git and wires `npm run mutation` to the runner', () => {
    expect(readFileSync(path.join(repo, '.gitignore'), 'utf8').split('\n')).toContain('reports/');
    const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')) as { scripts: Record<string, string>; devDependencies: Record<string, string>; dependencies: Record<string, string> };
    expect(pkg.scripts.mutation).toContain('scripts/mutation/mutation.ts');
    expect(pkg.devDependencies).toHaveProperty('@stryker-mutator/core');
    expect(pkg.devDependencies).toHaveProperty('@stryker-mutator/vitest-runner');
    expect(Object.keys(pkg.dependencies).filter((d) => d.startsWith('@stryker-mutator'))).toEqual([]);
  });
});

describe('vitest-file runner plugin', () => {
  it('narrows a mutant run to one name-less id per covering test file, because Vitest 5 matches -t against "describe > test" names', async () => {
    const { toFileFilter } = (await import(path.join(repo, 'scripts/mutation/vitestFileRunner.mjs'))) as { toFileFilter: (ids?: string[]) => string[] | undefined };
    expect(toFileFilter(['a.test.ts#x y', 'a.test.ts#x z', 'b.test.ts#q #hash'])).toEqual(['a.test.ts#', 'b.test.ts#']);
    expect(toFileFilter([])).toEqual([]);
    expect(toFileFilter(undefined)).toBeUndefined();
  });
});

describe('mutation CLI --check-only', () => {
  const run = (perModule: Record<string, [number, number]>) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mutation-cli-'));
    try {
      const file = path.join(dir, 'mutation.json');
      writeFileSync(file, JSON.stringify(report(perModule)));
      return spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/mutation/mutation.ts', '--check-only', file], { cwd: repo, encoding: 'utf8' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('exits non-zero and names the module when one module scores 79 percent', () => {
    const perModule = allAt(80, 20);
    perModule['src/main/externalUrlPolicy.ts'] = [79, 21];
    const result = run(perModule);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MUTATION FAIL src/main/externalUrlPolicy.ts');
  });

  it('exits 0 when all 8 modules score 80 percent or more', () => {
    const result = run(allAt(80, 20));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mutation: ok');
  });

  it('exits 2 when the report cannot be read', () => {
    const result = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/mutation/mutation.ts', '--check-only', '/nonexistent/mutation.json'], { cwd: repo, encoding: 'utf8' });
    expect(result.status).toBe(2);
  });
});
