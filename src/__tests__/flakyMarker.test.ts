import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { spawnSync } from "child_process";
import os from "os";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const REAL_SCRIPT = path.join(ROOT, "ci/mark-flaky.mjs");

/** Everything in a config that makes a failing test pass on a rerun or leaves its results unrecorded. */
function configProblems(name: string, text: string): string[] {
  const problems: string[] = [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const m of code.matchAll(/\b(retries|retry)\s*:\s*([^,\s}]+)/g)) {
    if (m[2] !== "0") problems.push(`${name}: ${m[1]} is ${m[2]}, expected 0`);
  }
  if (!/\[\s*['"]json['"]\s*,\s*\{\s*outputFile\s*:\s*['"][^'"]+['"]/.test(code)) {
    problems.push(`${name}: no json reporter with a fixed outputFile`);
  }
  return problems;
}

const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("retries stay 0 and both runners write a JSON report", () => {
  it("vitest.config.ts and playwright.config.ts are clean", () => {
    expect(configProblems("vitest.config.ts", read("vitest.config.ts"))).toEqual([]);
    expect(configProblems("playwright.config.ts", read("playwright.config.ts"))).toEqual([]);
  });

  it("a fixture config with retries: 1 is rejected", () => {
    const fixture = read("playwright.config.ts").replace(/retries: 0/, "retries: 1");
    expect(fixture).not.toBe(read("playwright.config.ts"));
    expect(configProblems("fixture", fixture)).toEqual(["fixture: retries is 1, expected 0"]);
  });

  it("a fixture vitest config with retry: 2 is rejected", () => {
    const fixture = read("vitest.config.ts").replace("globals: true,", "globals: true,\n    retry: 2,");
    expect(configProblems("fixture", fixture)).toEqual(["fixture: retry is 2, expected 0"]);
  });

  it("a fixture config without a json reporter is rejected", () => {
    const fixture = read("playwright.config.ts").replace(/\['json'[^\n]*\n/, "");
    expect(configProblems("fixture", fixture)).toEqual(["fixture: no json reporter with a fixed outputFile"]);
  });
});

const TESTS = {
  flaky: "fail-then-pass",
  stable: "pass-pass",
  broken: "fail-fail",
} as const;

type Status = "passed" | "failed";

/** A vitest JSON report of one run of the fixture suite. */
function vitestReport(status: Record<string, Status>, cwd: string): string {
  return JSON.stringify({
    testResults: [
      {
        name: path.join(cwd, "src/fixture.test.ts"),
        assertionResults: Object.values(TESTS).map((title) => ({
          ancestorTitles: ["fixture"],
          title,
          fullName: `fixture ${title}`,
          status: status[title],
        })),
      },
    ],
  });
}

/** A Playwright JSON report of one run of the same fixture suite. */
function playwrightReport(status: Record<string, Status>): string {
  return JSON.stringify({
    suites: [
      {
        title: "fixture.e2e.ts",
        file: "fixture.e2e.ts",
        specs: [],
        suites: [
          {
            title: "fixture",
            file: "fixture.e2e.ts",
            specs: Object.values(TESTS).map((title) => ({
              title,
              file: "fixture.e2e.ts",
              tests: [{ projectName: "electron", results: [{ status: status[title] === "passed" ? "passed" : "failed" }] }],
            })),
          },
        ],
      },
    ],
  });
}

/** The JUnit XML of the first (red) run, as vitest writes it. */
const JUNIT = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="2" errors="0" time="1">
    <testsuite name="src/fixture.test.ts" tests="3" failures="2" errors="0" skipped="0" time="1">
        <testcase classname="src/fixture.test.ts" name="fixture &gt; fail-then-pass" time="0.1">
            <failure message="boom" type="AssertionError">
AssertionError: boom
            </failure>
        </testcase>
        <testcase classname="src/fixture.test.ts" name="fixture &gt; pass-pass" time="0.1">
        </testcase>
        <testcase classname="src/fixture.test.ts" name="fixture &gt; fail-fail" time="0.1">
            <failure message="still red" type="AssertionError">
AssertionError: still red
            </failure>
        </testcase>
    </testsuite>
</testsuites>
`;

const RUN1: Record<string, Status> = { "fail-then-pass": "failed", "pass-pass": "passed", "fail-fail": "failed" };
const RUN2: Record<string, Status> = { "fail-then-pass": "passed", "pass-pass": "passed", "fail-fail": "failed" };

interface Outcome {
  exit: number | null;
  xml: string;
  count: string;
}

/** Runs `script` over the fixture reports in a scratch directory. */
function runMarker(script: string, kind: "vitest" | "playwright"): Outcome {
  const dir = mkdtempSync(path.join(os.tmpdir(), "flaky-"));
  try {
    const make = (s: Record<string, Status>) => (kind === "vitest" ? vitestReport(s, dir) : playwrightReport(s));
    writeFileSync(path.join(dir, "run1.json"), make(RUN1));
    writeFileSync(path.join(dir, "run2.json"), make(RUN2));
    const xmlPath = path.join(dir, "junit.xml");
    writeFileSync(
      xmlPath,
      kind === "vitest"
        ? JUNIT
        : JUNIT.replace(/classname="src\/fixture.test.ts" name="fixture &gt;/g, 'classname="fixture.e2e.ts" name="[electron] › fixture.e2e.ts:3:1 › fixture ›'),
    );
    const countPath = path.join(dir, "flaky-count.txt");
    const r = spawnSync(
      process.execPath,
      [script, "--junit", xmlPath, "--count-file", countPath, path.join(dir, "run1.json"), path.join(dir, "run2.json")],
      { cwd: dir, encoding: "utf8" },
    );
    let count = "";
    try {
      count = readFileSync(countPath, "utf8");
    } catch {
      /* no count file */
    }
    return { exit: r.status, xml: readFileSync(xmlPath, "utf8"), count };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The testcase element whose name ends with `title`, or "" when there is none. */
function caseOf(xml: string, title: string): string {
  const m = new RegExp(`<testcase\\b[^>]*${title}"[^>]*?(?:/>|>[\\s\\S]*?</testcase>)`).exec(xml);
  return m ? m[0] : "";
}

/** One problem per property of the marked JUnit output the criteria require. */
function markerProblems(o: Outcome): string[] {
  const problems: string[] = [];
  if (o.exit !== 0) problems.push(`exit ${o.exit}, expected 0`);
  const flaky = caseOf(o.xml, TESTS.flaky);
  if (!/<rerunFailure\b/.test(flaky)) problems.push("fail-then-pass has no <rerunFailure>");
  if (/<(failure|error)\b/.test(flaky)) problems.push("fail-then-pass is still failed");
  if (o.xml.match(new RegExp(`name="[^"]*${TESTS.flaky}"`, "g"))?.length !== 1) {
    problems.push("fail-then-pass is not exactly one testcase");
  }
  if (/<rerunFailure\b/.test(caseOf(o.xml, TESTS.stable))) problems.push("pass-pass was marked");
  const broken = caseOf(o.xml, TESTS.broken);
  if (!/<failure\b/.test(broken) || /<rerunFailure\b/.test(broken)) problems.push("fail-fail was not left failed");
  if (o.count.trim() !== "1") problems.push(`flaky count is ${JSON.stringify(o.count)}, expected 1`);
  if (!/<testsuites\b[^>]*\bfailures="1"/.test(o.xml)) problems.push("testsuites failures is not 1");
  if (!/<testsuite\b[^>]*\bfailures="1"/.test(o.xml)) problems.push("testsuite failures is not 1");
  return problems;
}

describe("ci/mark-flaky.mjs", () => {
  it.each(["vitest", "playwright"] as const)("marks only the fail-then-pass test from %s reports", (kind) => {
    expect(markerProblems(runMarker(REAL_SCRIPT, kind))).toEqual([]);
  });

  it("is red for a script that does nothing", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "flaky-stub-"));
    try {
      const stub = path.join(dir, "noop.mjs");
      writeFileSync(stub, "// stubbed\n");
      const problems = markerProblems(runMarker(stub, "vitest"));
      expect(problems).toContain("fail-then-pass has no <rerunFailure>");
      expect(problems).toContain("fail-then-pass is still failed");
      expect(problems.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with a single run (one vitest report, or one Playwright report without repeats)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "flaky-one-"));
    try {
      for (const [name, body] of [
        ["vitest.json", vitestReport(RUN1, dir)],
        ["pw.json", playwrightReport(RUN1)],
      ]) {
        writeFileSync(path.join(dir, name), body);
        writeFileSync(path.join(dir, "junit.xml"), JUNIT);
        const r = spawnSync(process.execPath, [REAL_SCRIPT, "--junit", "junit.xml", "--count-file", "c.txt", name], { cwd: dir, encoding: "utf8" });
        expect(r.status).toBe(2);
        expect(r.stderr).toContain("at least two runs");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats the repeats of one Playwright report (--repeat-each) as separate runs: the soak's single report per shard", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "flaky-repeat-"));
    try {
      const report = JSON.parse(playwrightReport(RUN1));
      const specs = report.suites[0].suites[0].specs as { title: string; tests: { projectName: string; results: { status: string }[] }[] }[];
      const second = JSON.parse(playwrightReport(RUN2)).suites[0].suites[0].specs as typeof specs;
      specs.forEach((spec, i) => spec.tests.push(second[i].tests[0]));
      writeFileSync(path.join(dir, "repeat.json"), JSON.stringify(report));
      writeFileSync(
        path.join(dir, "junit.xml"),
        JUNIT.replace(/classname="src\/fixture.test.ts" name="fixture &gt;/g, 'classname="fixture.e2e.ts" name="[electron] › fixture.e2e.ts:3:1 › fixture ›'),
      );
      const r = spawnSync(process.execPath, [REAL_SCRIPT, "--junit", "junit.xml", "--count-file", "count.txt", "repeat.json"], { cwd: dir, encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(readFileSync(path.join(dir, "count.txt"), "utf8").trim()).toBe("1");
      const xml = readFileSync(path.join(dir, "junit.xml"), "utf8");
      expect(/<rerunFailure\b/.test(caseOf(xml, TESTS.flaky))).toBe(true);
      expect(/<failure\b/.test(caseOf(xml, TESTS.broken))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rewrites every --junit file: the repeats of a test split over shards are one run each in different reports", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "flaky-shards-"));
    try {
      const pw = (rows: [string, Status][]) =>
        JSON.stringify({
          suites: [
            {
              title: "fixture.e2e.ts",
              file: "fixture.e2e.ts",
              specs: rows.map(([title, state]) => ({
                title,
                file: "fixture.e2e.ts",
                tests: [{ projectName: "electron", results: [{ status: state === "passed" ? "passed" : "failed" }] }],
              })),
            },
          ],
        });
      const junit = (title: string, failed: boolean) =>
        `<testsuites tests="1" failures="${failed ? 1 : 0}" errors="0"><testsuite name="s" tests="1" failures="${failed ? 1 : 0}" errors="0">` +
        `<testcase classname="fixture.e2e.ts" name="[electron] › fixture.e2e.ts:3:1 › ${title}">${failed ? '<failure message="boom"></failure>' : ""}</testcase></testsuite></testsuites>`;
      writeFileSync(path.join(dir, "a.json"), pw([["flaky", "failed"]]));
      writeFileSync(path.join(dir, "b.json"), pw([["flaky", "passed"]]));
      writeFileSync(path.join(dir, "a.xml"), junit("flaky", true));
      writeFileSync(path.join(dir, "b.xml"), junit("flaky", false));
      const r = spawnSync(process.execPath, [REAL_SCRIPT, "--junit", "a.xml", "--junit", "b.xml", "--count-file", "count.txt", "a.json", "b.json"], { cwd: dir, encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(readFileSync(path.join(dir, "count.txt"), "utf8").trim()).toBe("1");
      const a = readFileSync(path.join(dir, "a.xml"), "utf8");
      const b = readFileSync(path.join(dir, "b.xml"), "utf8");
      expect(a).toContain("<rerunFailure");
      expect(a).not.toContain("<failure");
      expect(b).toContain("<rerunFailure");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
