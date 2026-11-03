import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { execFile } from "child_process";
import path from "path";
import vitestConfig from "../../vitest.config";

const root = path.resolve(__dirname, "../..");

describe("vitest coverage on a failing run", () => {
  it("is configured to report coverage on failure", () => {
    expect((vitestConfig as { test?: { coverage?: { reportOnFailure?: boolean } } }).test?.coverage?.reportOnFailure).toBe(true);
  });

  type Probe = { status: number | null; dir: string };

  /** Runs the repo's real vitest config over a throwaway project holding `tests`; resolves to the exit status and the project dir. */
  function runProject(tests: Record<string, string>, configOverride = ""): Promise<Probe> {
    // Inside the repo so `vitest` and the config's own imports resolve from its node_modules.
    const dir = mkdtempSync(path.join(root, ".coverage-probe-"));
    mkdirSync(path.join(dir, "src/__tests__"), { recursive: true });
    writeFileSync(path.join(dir, "src/__tests__/setup.ts"), "");
    writeFileSync(path.join(dir, "src/lib.ts"), "export const inc = (a: number) => a + 1;\n");
    for (const [name, body] of Object.entries(tests)) writeFileSync(path.join(dir, "src/__tests__", name), body);
    // The repo's real coverage block, run in the node environment with only the default reporter so each probe starts fast.
    writeFileSync(
      path.join(dir, "vitest.config.mts"),
      `import base from '../vitest.config';\n` +
        `const test = base.test ?? {};\n` +
        `export default { ...base, plugins: [], test: { ...test, environment: 'node', setupFiles: [], reporters: ['default'], coverage: { ...test.coverage, reportsDirectory: 'cov', thresholds: {} ${configOverride} } } };\n`,
    );
    return new Promise((resolve) => {
      execFile(
        path.join(root, "node_modules/.bin/vitest"),
        ["run", "--root", dir, "--config", path.join(dir, "vitest.config.mts"), "--coverage"],
        { cwd: root, env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" }, maxBuffer: 64 * 1024 * 1024 },
        (error) => resolve({ status: error ? ((error as { code?: number }).code ?? 1) : 0, dir }),
      );
    });
  }

  const FAILING = `import { it, expect } from 'vitest';\nimport { inc } from '../lib';\nit('fails on purpose', () => { expect(inc(1)).toBe(3); });\n`;
  const PASSING = `import { it, expect } from 'vitest';\nimport { inc } from '../lib';\nit('passes', () => { expect(inc(1)).toBe(2); });\n`;
  const BROKEN_SUITE = `import { it } from 'vitest';\nimport './does-not-exist';\nit('never runs', () => {});\n`;

  // A probe is a whole nested vitest run (about half a second alone, several seconds on a loaded CI host), so the four
  // run concurrently here instead of one after another inside the 5-second per-test bound.
  let probes: { single: Probe; mixed: Probe; broken: Probe; off: Probe };
  beforeAll(async () => {
    const [single, mixed, broken, off] = await Promise.all([
      runProject({ "a.test.ts": FAILING }),
      runProject({ "a.test.ts": FAILING, "b.test.ts": PASSING }),
      runProject({ "a.test.ts": BROKEN_SUITE, "b.test.ts": PASSING }),
      runProject({ "a.test.ts": FAILING }, ", reportOnFailure: false"),
    ]);
    probes = { single, mixed, broken, off };
  });
  afterAll(() => {
    for (const probe of Object.values(probes ?? {})) rmSync(probe.dir, { recursive: true, force: true });
  });

  function summaryOf(dir: string): { total: { lines: { pct: number } } } {
    return JSON.parse(readFileSync(path.join(dir, "cov/coverage-summary.json"), "utf8"));
  }

  it("writes coverage-summary.json, coverage-final.json and lcov.info when a test fails", () => {
    const { status, dir } = probes.single;
    expect(status).not.toBe(0);
    for (const file of ["coverage-summary.json", "coverage-final.json", "lcov.info"]) expect(existsSync(path.join(dir, "cov", file)), file).toBe(true);
    expect(summaryOf(dir).total.lines.pct).toBe(100);
  });

  function expectCoverageOnRedRun({ status, dir }: Probe): void {
    expect(status).not.toBe(0);
    expect(existsSync(path.join(dir, "cov/coverage-summary.json"))).toBe(true);
    expect(existsSync(path.join(dir, "cov/lcov.info"))).toBe(true);
  }

  it("writes coverage when one file fails and another passes", () => {
    expectCoverageOnRedRun(probes.mixed);
  });

  it("writes coverage when a suite fails to load", () => {
    expectCoverageOnRedRun(probes.broken);
  });

  it("writes no coverage for a failing run once reportOnFailure is off (negative control)", () => {
    const { status, dir } = probes.off;
    expect(status).not.toBe(0);
    expect(existsSync(path.join(dir, "cov/coverage-summary.json"))).toBe(false);
  });
});
