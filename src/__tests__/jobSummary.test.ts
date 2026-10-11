import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseCoverageSummary,
  parseCrapSummary,
  parseJunitTotals,
  e2eHasFailure,
  parsePlaywrightCounts,
  renderE2eSummary,
  renderQualitySummary,
  type QualityInput,
} from "../../scripts/summary/jobSummary";

const thresholds = { statements: 83, branches: 72, functions: 83, lines: 84 };
const green: QualityInput = {
  unit: { total: 1789, failed: 0, skipped: 27 },
  coverage: { pct: { statements: 90.37, branches: 81.66, functions: 89.7, lines: 91.72 } },
  thresholds,
  crap: { max: 30, functions: 640, over: 0 },
};

/** The expected lines that the rendered markdown does not contain. */
function missingLines(markdown: string, expected: string[]): string[] {
  const lines = markdown.split("\n");
  return expected.filter((line) => !lines.includes(line));
}

const GREEN_LINES = [
  "✅ 1789 tests: 1762 passed, 0 failed, 27 skipped",
  "| statements | 90.37% | 83% | ✅ met |",
  "| branches | 81.66% | 72% | ✅ met |",
  "| functions | 89.7% | 83% | ✅ met |",
  "| lines | 91.72% | 84% | ✅ met |",
  "✅ 0 functions over CRAP_MAX (30) of 640 scored",
];

describe("job summary renderer", () => {
  it("case 1, all green: unit totals, four coverage totals against thresholds, zero CRAP offenders", () => {
    expect(missingLines(renderQualitySummary(green), GREEN_LINES)).toEqual([]);
  });

  it("case 2, a coverage total below its threshold is shown as a miss, the others stay met", () => {
    const input: QualityInput = { ...green, coverage: { pct: { ...green.coverage!.pct, branches: 70.5 } }, crap: { max: 30, functions: 640, over: 2 } };
    const markdown = renderQualitySummary(input);
    expect(missingLines(markdown, [
      "| branches | 70.5% | 72% | ❌ miss (1.5% below) |",
      "| statements | 90.37% | 83% | ✅ met |",
      "| lines | 91.72% | 84% | ✅ met |",
      "❌ 2 functions over CRAP_MAX (30) of 640 scored",
    ])).toEqual([]);
    expect(markdown).not.toContain("| branches | 70.5% | 72% | ✅ met |");
  });

  it("case 3, an e2e shard with failed tests shows its passed, failed and skipped counts", () => {
    const markdown = renderE2eSummary({ shard: "2/2", counts: { passed: 95, failed: 3, skipped: 1, errors: 0 } });
    expect(missingLines(markdown, ["## e2e shard 2/2", "❌ 95 passed, 3 failed, 1 skipped"])).toEqual([]);
    expect(renderE2eSummary({ shard: "1/2", counts: { passed: 98, failed: 0, skipped: 0, errors: 0 } })).toContain("✅ 98 passed, 0 failed, 0 skipped");
  });

  it("detects a renderer that drops a line it should print (negative cases)", () => {
    const markdown = renderQualitySummary(green);
    for (const line of GREEN_LINES) {
      const dropped = markdown.split("\n").filter((l) => l !== line).join("\n");
      expect(missingLines(dropped, GREEN_LINES)).toEqual([line]);
    }
  });

  it("says so when a report file was not produced instead of inventing numbers", () => {
    const markdown = renderQualitySummary({ unit: null, coverage: null, thresholds, crap: null });
    expect(markdown.match(/no data/g)).toHaveLength(3);
    expect(renderE2eSummary({ shard: "1/2", counts: null })).toContain("no data");
  });
});

describe("job summary renderer, exact markdown", () => {
  it("renders the whole quality summary with its headings, blank lines and table header", () => {
    expect(renderQualitySummary(green)).toBe(
      [
        "## Quality",
        "",
        "### Unit tests",
        "",
        "✅ 1789 tests: 1762 passed, 0 failed, 27 skipped",
        "",
        "### Coverage",
        "",
        "| Metric | Coverage | Threshold | |",
        "| --- | ---: | ---: | --- |",
        "| statements | 90.37% | 83% | ✅ met |",
        "| branches | 81.66% | 72% | ✅ met |",
        "| functions | 89.7% | 83% | ✅ met |",
        "| lines | 91.72% | 84% | ✅ met |",
        "",
        "### CRAP",
        "",
        "✅ 0 functions over CRAP_MAX (30) of 640 scored",
        "",
      ].join("\n"),
    );
  });

  it("renders the missing-data placeholder under every heading when no report was produced", () => {
    const missing = "_no data: the report file was not produced_";
    expect(renderQualitySummary({ unit: null, coverage: null, thresholds, crap: null })).toBe(
      ["## Quality", "", "### Unit tests", "", missing, "", "### Coverage", "", missing, "", "### CRAP", "", missing, ""].join("\n"),
    );
    expect(renderE2eSummary({ shard: "1/2", counts: null })).toBe(["## e2e shard 1/2", "", missing, ""].join("\n"));
  });

  it("renders the whole e2e summary with the blank line after its heading", () => {
    expect(renderE2eSummary({ shard: "2/2", counts: { passed: 95, failed: 3, skipped: 1, errors: 0 } })).toBe(
      "## e2e shard 2/2\n\n❌ 95 passed, 3 failed, 1 skipped\n",
    );
  });

  it("marks failed unit tests and subtracts failed and skipped tests from the passed count", () => {
    const markdown = renderQualitySummary({ ...green, unit: { total: 100, failed: 4, skipped: 6 } });
    expect(markdown.split("\n")).toContain("❌ 100 tests: 90 passed, 4 failed, 6 skipped");
  });

  it("counts a coverage value equal to its threshold as met", () => {
    const input: QualityInput = { ...green, coverage: { pct: { ...green.coverage!.pct, lines: 84 } } };
    expect(renderQualitySummary(input).split("\n")).toContain("| lines | 84% | 84% | ✅ met |");
  });

  it("uses the singular 'function' for exactly one offender and the plural otherwise", () => {
    const lines = (over: number) => renderQualitySummary({ ...green, crap: { max: 30, functions: 640, over } }).split("\n");
    expect(lines(1)).toContain("❌ 1 function over CRAP_MAX (30) of 640 scored");
    expect(lines(2)).toContain("❌ 2 functions over CRAP_MAX (30) of 640 scored");
    expect(lines(0)).toContain("✅ 0 functions over CRAP_MAX (30) of 640 scored");
  });
});

describe("job summary report parsers", () => {
  it("reads the totals of a JUnit file, counting failures and errors as failed", () => {
    const xml = '<?xml version="1.0"?>\n<testsuites name="vitest tests" tests="10" failures="1" errors="2" time="3">\n<testsuite tests="10"><testcase name="a"><skipped/></testcase></testsuite></testsuites>';
    expect(parseJunitTotals(xml)).toEqual({ total: 10, failed: 3, skipped: 1 });
    expect(parseJunitTotals('<testsuites tests="3" failures="0" errors="0" skipped="2">')).toEqual({ total: 3, failed: 0, skipped: 2 });
    expect(() => parseJunitTotals("<nope/>")).toThrow("junit.xml has no <testsuites> element");
  });

  it("reads each JUnit attribute by its own name and counts <skipped> elements when the attribute is absent", () => {
    expect(parseJunitTotals('<testsuites name="x" failures="1" errors="2" tests="10">')).toEqual({ total: 10, failed: 3, skipped: 0 });
    expect(parseJunitTotals('<testsuites tests="4" failures="0"><testcase><skipped/></testcase><testcase><skipped message="m"/></testcase>')).toEqual({ total: 4, failed: 0, skipped: 2 });
    expect(parseJunitTotals("<testsuites>")).toEqual({ total: 0, failed: 0, skipped: 0 });
  });

  it("reads the four totals of coverage-summary.json", () => {
    const text = JSON.stringify({ total: { lines: { pct: 1 }, statements: { pct: 2 }, functions: { pct: 3 }, branches: { pct: 4 } } });
    expect(parseCoverageSummary(text).pct).toEqual({ lines: 1, statements: 2, functions: 3, branches: 4 });
    expect(() => parseCoverageSummary("{}")).toThrow('coverage-summary.json has no "total"');
  });

  it("reads a missing, non-numeric or non-finite coverage percentage as 0", () => {
    const text = '{"total":{"lines":{"pct":"87"},"statements":{"pct":null},"functions":{"pct":1e999},"branches":{}}}';
    expect(parseCoverageSummary(text).pct).toEqual({ lines: 0, statements: 0, functions: 0, branches: 0 });
    expect(parseCoverageSummary('{"total":{"lines":{"pct":88.5}}}').pct).toEqual({ lines: 88.5, statements: 0, functions: 0, branches: 0 });
  });

  it("reads the CRAP totals and Playwright stats (flaky counts as passed)", () => {
    expect(parseCrapSummary('{"max":30,"functions":5,"over":1}')).toEqual({ max: 30, functions: 5, over: 1 });
    expect(parsePlaywrightCounts('{"stats":{"expected":7,"flaky":1,"unexpected":2,"skipped":3}}')).toEqual({ passed: 8, failed: 2, skipped: 3, errors: 0 });
    expect(() => parsePlaywrightCounts("{}")).toThrow('Playwright JSON report has no "stats"');
  });

  it("counts the top-level errors array, the only trace of a global setup or teardown failure", () => {
    const stats = '"stats":{"expected":0,"flaky":0,"unexpected":0,"skipped":0}';
    expect(parsePlaywrightCounts(`{${stats},"errors":[{"message":"Independent gate: global setup failed before any test ran"}]}`)).toEqual({
      passed: 0, failed: 0, skipped: 0, errors: 1,
    });
    expect(parsePlaywrightCounts(`{"stats":{"expected":9,"unexpected":0},"errors":[{},{}]}`)).toMatchObject({ passed: 9, failed: 0, errors: 2 });
    expect(parsePlaywrightCounts(`{${stats},"errors":[]}`).errors).toBe(0);
    expect(parsePlaywrightCounts(`{${stats},"errors":"boom"}`).errors).toBe(0);
    expect(e2eHasFailure({ passed: 5, failed: 0, skipped: 0, errors: 0 })).toBe(false);
    expect(e2eHasFailure({ passed: 5, failed: 1, skipped: 0, errors: 0 })).toBe(true);
    expect(e2eHasFailure({ passed: 0, failed: 0, skipped: 0, errors: 1 })).toBe(true);
  });

  it("marks an e2e shard with report-level errors failed even when every test passed", () => {
    expect(renderE2eSummary({ shard: "1/2", counts: { passed: 0, failed: 0, skipped: 0, errors: 1 } })).toContain("❌ 0 passed, 0 failed, 0 skipped, 1 report error\n");
    expect(renderE2eSummary({ shard: "1/2", counts: { passed: 98, failed: 0, skipped: 0, errors: 3 } })).toContain("❌ 98 passed, 0 failed, 0 skipped, 3 report errors");
  });

  it("reads non-numeric report fields as 0", () => {
    expect(parseCrapSummary('{"max":"30","functions":null,"over":1e999}')).toEqual({ max: 0, functions: 0, over: 0 });
    expect(parsePlaywrightCounts('{"stats":{"expected":"7","flaky":null,"unexpected":1e999}}')).toEqual({ passed: 0, failed: 0, skipped: 0, errors: 0 });
  });
});

describe("summary CLI", () => {
  const cli = path.resolve(__dirname, "../../scripts/summary/summary.ts");
  const run = (dir: string, args: string[], target?: string) =>
    spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", cli, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: target ?? "" },
    });

  it("appends the e2e shard summary to $GITHUB_STEP_SUMMARY and tolerates missing reports", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "summary-cli-"));
    try {
      const target = path.join(dir, "step-summary.md");
      writeFileSync(target, "earlier\n");
      mkdirSync(path.join(dir, "test-results"));
      writeFileSync(path.join(dir, "test-results/results.json"), JSON.stringify({ stats: { expected: 4, unexpected: 1, skipped: 2, flaky: 0 } }));
      expect(run(dir, ["e2e", "1/2"], target).status).toBe(0);
      expect(readFileSync(target, "utf8")).toBe("earlier\n## e2e shard 1/2\n\n❌ 4 passed, 1 failed, 2 skipped\n");
      rmSync(path.join(dir, "test-results"), { recursive: true });
      expect(run(dir, ["e2e", "2/2"], target).status).toBe(0);
      expect(readFileSync(target, "utf8")).toContain("## e2e shard 2/2\n\n_no data");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders the quality summary from the report files using the thresholds in vitest.config.ts", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "summary-cli-"));
    try {
      mkdirSync(path.join(dir, "coverage"));
      mkdirSync(path.join(dir, "junit"));
      writeFileSync(path.join(dir, "vitest.config.ts"), "thresholds: { lines: 84, functions: 83, branches: 72, statements: 83 }");
      writeFileSync(path.join(dir, "junit/junit.xml"), '<testsuites tests="5" failures="0" errors="0">');
      const pct = (p: number) => ({ pct: p });
      writeFileSync(path.join(dir, "coverage/coverage-summary.json"), JSON.stringify({ total: { lines: pct(90), functions: pct(90), branches: pct(60), statements: pct(90) } }));
      writeFileSync(path.join(dir, "coverage/crap-summary.json"), '{"max":30,"functions":10,"over":3}');
      const result = run(dir, ["quality"]);
      expect(result.status).toBe(0);
      expect(missingLines(result.stdout, [
        "✅ 5 tests: 5 passed, 0 failed, 0 skipped",
        "| branches | 60% | 72% | ❌ miss (12% below) |",
        "❌ 3 functions over CRAP_MAX (30) of 10 scored",
      ])).toEqual([]);
      expect(run(dir, ["bogus"]).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
