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

  it("exits 2 with fewer than two reports", () => {
    const r = spawnSync(process.execPath, [REAL_SCRIPT, "--junit", "x.xml", "--count-file", "c.txt", "one.json"], { encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});
