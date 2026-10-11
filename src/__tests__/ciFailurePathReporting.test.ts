import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { parse } from "yaml";
import vitestConfig from "../../vitest.config";

type Step = { name?: string; if?: string; run?: string };
const root = path.resolve(__dirname, "../..");
const ci = parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));

/** True when a step's condition lets it run after an earlier step of the job failed. */
function runsAfterFailure(step: Step | undefined): boolean {
  const condition = (step?.if ?? "").replace(/\$\{\{|\}\}/g, "").trim();
  return condition === "always()" || condition === "!cancelled()";
}

/** The quality-job steps whose output the failure-path summary and uploads are built from. */
const EVIDENCE_STEPS = ["npm run test:coverage", "npm run crap"];

function evidenceStepProblems(workflow: unknown): string[] {
  const steps = (workflow as { jobs?: { quality?: { steps?: Step[] } } })?.jobs?.quality?.steps ?? [];
  return EVIDENCE_STEPS.flatMap((command) => {
    const step = steps.find((s) => s.run?.trim() === command);
    if (!step) return [`quality has no step running ${command}`];
    return runsAfterFailure(step) ? [] : [`${command} must run after an earlier red step, got if: ${step.if}`];
  });
}

describe("ci.yml quality evidence steps on the failure path", () => {
  it("runs the unit tests and the CRAP score even when an earlier step failed", () => {
    expect(evidenceStepProblems(ci)).toEqual([]);
  });

  it("flags a tests or CRAP step that only runs after success (negative cases)", () => {
    const wf = (conditions: (string | undefined)[]) => ({
      jobs: { quality: { steps: EVIDENCE_STEPS.map((run, i) => ({ run, if: conditions[i] })) } },
    });
    expect(evidenceStepProblems(wf(["${{ !cancelled() }}", "always()"]))).toEqual([]);
    expect(evidenceStepProblems(wf([undefined, "always()"]))).toHaveLength(1);
    expect(evidenceStepProblems(wf(["always()", undefined]))).toHaveLength(1);
    expect(evidenceStepProblems(wf(["success()", "failure()"]))).toHaveLength(2);
    expect(evidenceStepProblems({ jobs: { quality: { steps: [] } } })).toHaveLength(2);
  });

  it("keeps typecheck and lint before the unit tests, so a red gate still reaches them", () => {
    const steps = (ci as { jobs: { quality: { steps: Step[] } } }).jobs.quality.steps;
    const index = (command: string) => steps.findIndex((s) => s.run?.trim() === command);
    expect(index("npm run typecheck")).toBeGreaterThan(-1);
    expect(index("npm run lint")).toBeGreaterThan(index("npm run typecheck"));
    expect(index("npm run test:coverage")).toBeGreaterThan(index("npm run lint"));
    expect(index("npm run crap")).toBeGreaterThan(index("npm run test:coverage"));
  });
});

describe("vitest coverage on a failing run", () => {
  it("is configured to report coverage on failure", () => {
    expect((vitestConfig as { test?: { coverage?: { reportOnFailure?: boolean } } }).test?.coverage?.reportOnFailure).toBe(true);
  });

  /** Runs the repo's real vitest config over a throwaway project holding `tests`; returns the exit status and the project dir. */
  function runProject(tests: Record<string, string>, configOverride = ""): { status: number | null; dir: string } {
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
    const result = spawnSync(
      path.join(root, "node_modules/.bin/vitest"),
      ["run", "--root", dir, "--config", path.join(dir, "vitest.config.mts"), "--coverage"],
      { cwd: root, encoding: "utf8", env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" } },
    );
    return { status: result.status, dir };
  }

  const FAILING = `import { it, expect } from 'vitest';\nimport { inc } from '../lib';\nit('fails on purpose', () => { expect(inc(1)).toBe(3); });\n`;
  const PASSING = `import { it, expect } from 'vitest';\nimport { inc } from '../lib';\nit('passes', () => { expect(inc(1)).toBe(2); });\n`;
  const BROKEN_SUITE = `import { it } from 'vitest';\nimport './does-not-exist';\nit('never runs', () => {});\n`;

  function summaryOf(dir: string): { total: { lines: { pct: number } } } {
    return JSON.parse(readFileSync(path.join(dir, "cov/coverage-summary.json"), "utf8"));
  }

  it("writes coverage-summary.json, coverage-final.json and lcov.info when a test fails", () => {
    const { status, dir } = runProject({ "a.test.ts": FAILING });
    try {
      expect(status).not.toBe(0);
      for (const file of ["coverage-summary.json", "coverage-final.json", "lcov.info"]) expect(existsSync(path.join(dir, "cov", file)), file).toBe(true);
      expect(summaryOf(dir).total.lines.pct).toBe(100);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function expectCoverageOnRedRun(tests: Record<string, string>): void {
    const { status, dir } = runProject(tests);
    try {
      expect(status).not.toBe(0);
      expect(existsSync(path.join(dir, "cov/coverage-summary.json"))).toBe(true);
      expect(existsSync(path.join(dir, "cov/lcov.info"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("writes coverage when one file fails and another passes", () => {
    expectCoverageOnRedRun({ "a.test.ts": FAILING, "b.test.ts": PASSING });
  });

  it("writes coverage when a suite fails to load", () => {
    expectCoverageOnRedRun({ "a.test.ts": BROKEN_SUITE, "b.test.ts": PASSING });
  });

  it("writes no coverage for a failing run once reportOnFailure is off (negative control)", () => {
    const { status, dir } = runProject({ "a.test.ts": FAILING }, ", reportOnFailure: false");
    try {
      expect(status).not.toBe(0);
      expect(existsSync(path.join(dir, "cov/coverage-summary.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
