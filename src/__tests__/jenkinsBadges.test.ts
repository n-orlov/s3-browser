import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BadgeInput } from "../../scripts/badges/badges";
import { jenkinsBadges, renderBadgeLines } from "../../scripts/badges/jenkinsBadges";

const root = path.resolve(__dirname, "..", "..");
const ratchet = { maxWarnings: 0, mutationScoreMin: 80, coverageThresholds: { lines: 90, functions: 90, branches: 80, statements: 90 } };
const green: BadgeInput = {
  ratchet,
  lint: { errors: 0, warnings: 0 },
  coverage: { pct: { lines: 96.123, functions: 95, branches: 90, statements: 95 } },
  crap: { max: 20, functions: 100, over: 0 },
  unit: { total: 110, failed: 0, skipped: 10 },
  e2e: { passed: 50, failed: 0, skipped: 0, errors: 0 },
  mutation: 91.5,
};
const empty: BadgeInput = { ratchet, lint: null, coverage: null, crap: null, unit: null, e2e: null, mutation: null };

describe("jenkinsBadges", () => {
  it("is green for a clean build, summing the passed unit and e2e tests", () => {
    expect(jenkinsBadges(green)).toEqual({
      tests: { status: "150 passed", color: "brightgreen" },
      coverage: { status: "96.12%", color: "brightgreen" },
      quality: { status: "passing", color: "brightgreen" },
      mutation: { status: "91.5%", color: "brightgreen" },
    });
  });

  it("reads 'not run' in grey for every badge whose report is missing", () => {
    const notRun = { status: "not run", color: "lightgrey" };
    expect(jenkinsBadges(empty)).toEqual({ tests: notRun, coverage: notRun, quality: notRun, mutation: notRun });
  });

  it("is red for a failed unit test, an e2e failure or an e2e report error", () => {
    expect(jenkinsBadges({ ...green, unit: { total: 10, failed: 2, skipped: 0 } }).tests).toEqual({ status: "2 failed", color: "red" });
    expect(jenkinsBadges({ ...green, e2e: { passed: 0, failed: 1, skipped: 0, errors: 1 } }).tests).toEqual({ status: "2 failed", color: "red" });
  });

  it("colours coverage and mutation against the ratchet floor: red below, yellow within 5 points, green above", () => {
    expect(jenkinsBadges({ ...green, coverage: { pct: { ...green.coverage!.pct, lines: 89 } } }).coverage.color).toBe("red");
    expect(jenkinsBadges({ ...green, coverage: { pct: { ...green.coverage!.pct, lines: 92 } } }).coverage.color).toBe("yellow");
    expect(jenkinsBadges({ ...green, mutation: 79 }).mutation.color).toBe("red");
    expect(jenkinsBadges({ ...green, mutation: 82 }).mutation.color).toBe("yellow");
  });

  it("is failing for a CRAP offender, a lint warning or a lint error", () => {
    expect(jenkinsBadges({ ...green, crap: { max: 20, functions: 100, over: 1 } }).quality).toEqual({ status: "failing", color: "red" });
    expect(jenkinsBadges({ ...green, lint: { errors: 0, warnings: 1 } }).quality.status).toBe("failing");
    expect(jenkinsBadges({ ...green, lint: { errors: 1, warnings: 0 } }).quality.status).toBe("failing");
  });

  it("renders one id=status|color line per badge", () => {
    expect(renderBadgeLines(jenkinsBadges(green))).toBe(
      "tests=150 passed|brightgreen\ncoverage=96.12%|brightgreen\nquality=passing|brightgreen\nmutation=91.5%|brightgreen\n",
    );
  });
});

describe("npm run badges:ci", () => {
  const script = path.join(root, "scripts", "badges", "jenkins.ts");
  const run = (cwd: string, args: string[]) =>
    spawnSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args], { cwd, encoding: "utf8" });

  it("writes 'not run' lines for a workspace without reports", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jenkins-badges-"));
    const result = run(dir, ["out/badges.txt"]);
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(dir, "out", "badges.txt"), "utf8")).toBe(
      "tests=not run|lightgrey\ncoverage=not run|lightgrey\nquality=not run|lightgrey\nmutation=not run|lightgrey\n",
    );
  });

  it("reads the unit, coverage, e2e shard and lint reports of a build", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jenkins-badges-"));
    for (const sub of ["junit", "coverage", "reports", "e2e-1/test-results", "e2e-2/test-results"]) mkdirSync(path.join(dir, sub), { recursive: true });
    writeFileSync(path.join(dir, ".ratchet.json"), JSON.stringify(ratchet));
    writeFileSync(path.join(dir, "junit", "junit.xml"), '<testsuites tests="12" failures="0" errors="0" skipped="2"></testsuites>');
    writeFileSync(path.join(dir, "coverage", "coverage-summary.json"), JSON.stringify({ total: { lines: { pct: 91 }, statements: { pct: 91 }, functions: { pct: 91 }, branches: { pct: 91 } } }));
    writeFileSync(path.join(dir, "coverage", "crap-summary.json"), JSON.stringify({ max: 20, functions: 5, over: 0 }));
    writeFileSync(path.join(dir, "reports", "eslint.json"), "[]");
    const shard = (expected: number) => JSON.stringify({ stats: { expected, unexpected: 0, skipped: 0, flaky: 0 }, errors: [] });
    writeFileSync(path.join(dir, "e2e-1", "test-results", "results.json"), shard(3));
    writeFileSync(path.join(dir, "e2e-2", "test-results", "results.json"), shard(4));
    expect(run(dir, ["badges.txt"]).status).toBe(0);
    expect(readFileSync(path.join(dir, "badges.txt"), "utf8")).toBe(
      "tests=17 passed|brightgreen\ncoverage=91%|yellow\nquality=passing|brightgreen\nmutation=not run|lightgrey\n",
    );
  });

  it("exits 2 without an output file", () => {
    expect(run(mkdtempSync(path.join(tmpdir(), "jenkins-badges-")), []).status).toBe(2);
  });
});
