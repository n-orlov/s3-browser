import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseCoverageSummary,
  parseCrapSummary,
  parseJunitTotals,
  e2eHasFailure,
  parsePlaywrightCounts,
  type QualityInput,
} from "../../scripts/summary/jobSummary";
import { escapeHtml, parseFlakyCount, renderSummaryPage } from "../../scripts/summary/summaryPage";

const thresholds = { statements: 83, branches: 72, functions: 83, lines: 84 };
const green: QualityInput = {
  unit: { total: 1789, failed: 0, skipped: 27 },
  coverage: { pct: { statements: 90.37, branches: 81.66, functions: 89.7, lines: 91.72 } },
  thresholds,
  crap: { max: 30, functions: 640, over: 0 },
};

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

  it("reads non-numeric report fields as 0", () => {
    expect(parseCrapSummary('{"max":"30","functions":null,"over":1e999}')).toEqual({ max: 0, functions: 0, over: 0 });
    expect(parsePlaywrightCounts('{"stats":{"expected":"7","flaky":null,"unexpected":1e999}}')).toEqual({ passed: 0, failed: 0, skipped: 0, errors: 0 });
  });
});

describe("summary CLI", () => {
  const cli = path.resolve(__dirname, "../../scripts/summary/summary.ts");

  it("only writes the HTML page: the former markdown modes are a usage error and nothing reaches $GITHUB_STEP_SUMMARY", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "summary-cli-"));
    try {
      const target = path.join(dir, "step-summary.md");
      for (const args of [["quality"], ["e2e", "1/2"], []]) {
        const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", cli, ...args], {
          cwd: dir,
          encoding: "utf8",
          env: { ...process.env, GITHUB_STEP_SUMMARY: target },
        });
        expect(result.status).toBe(2);
        expect(result.stderr).toContain("usage: summary.ts html [dir]");
      }
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CI summary page", () => {
  const e2e = [
    { shard: "1", counts: { passed: 40, failed: 0, skipped: 1, errors: 0 } },
    { shard: "2", counts: { passed: 55, failed: 2, skipped: 0, errors: 1 } },
    { shard: "3", counts: null },
  ];

  it("shows the unit and e2e counts, the coverage totals against their thresholds, CRAP and the flaky count", () => {
    const html = renderSummaryPage({ quality: green, e2e, flaky: 2 });
    for (const expected of [
      "<title>CI summary</title>",
      "1789 tests: 1762 passed, 0 failed, 27 skipped",
      "<tr class=\"ok\"><td>branches</td><td>81.66%</td><td>72%</td><td>✅ met</td></tr>",
      "0 functions over CRAP_MAX (30) of 640 scored",
      "<td>shard 1</td><td>✅</td><td>40 passed, 0 failed, 1 skipped</td>",
      "<td>shard 2</td><td>❌</td><td>55 passed, 2 failed, 0 skipped, 1 report error</td>",
      "<td>shard 3</td><td colspan=\"2\" class=\"nodata\">no data: the report file was not produced</td>",
      "<p class=\"bad\">❌ 2 flaky tests</p>",
    ]) {
      expect(html).toContain(expected);
    }
  });

  it("marks a coverage miss, CRAP offenders and failed unit tests in red and a clean flaky count in green", () => {
    const quality: QualityInput = {
      unit: { total: 10, failed: 1, skipped: 0 },
      coverage: { pct: { ...green.coverage!.pct, branches: 70.5 } },
      thresholds,
      crap: { max: 30, functions: 5, over: 1 },
    };
    const html = renderSummaryPage({ quality, e2e: [], flaky: 0 });
    expect(html).toContain("<tr class=\"bad\"><td>branches</td><td>70.5%</td><td>72%</td><td>❌ miss (1.5% below)</td></tr>");
    expect(html).toContain("<p class=\"bad\">❌ 1 function over CRAP_MAX (30) of 5 scored</p>");
    expect(html).toContain("<p class=\"bad\">❌ 10 tests: 9 passed, 1 failed, 0 skipped</p>");
    expect(html).toContain("<p class=\"ok\">✅ 0 flaky tests</p>");
    expect(renderSummaryPage({ quality, e2e: [], flaky: 1 })).toContain("❌ 1 flaky test</p>");
  });

  it("says so for every part whose report was not produced, never zeros", () => {
    const html = renderSummaryPage({ quality: { unit: null, coverage: null, thresholds, crap: null }, e2e: [], flaky: null });
    expect(html.match(/no data: the report file was not produced/g)).toHaveLength(4);
    expect(html).toContain("not measured: no flaky-count file was produced");
  });

  it("escapes markup in the values it prints and reads a flaky-count file strictly", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    expect(renderSummaryPage({ quality: green, e2e: [{ shard: "<b>", counts: null }], flaky: 0 })).toContain("shard &lt;b&gt;");
    expect(parseFlakyCount("2\n")).toBe(2);
    expect(parseFlakyCount("two")).toBeNull();
    expect(parseFlakyCount("")).toBeNull();
  });

  it("is written by `summary.ts html` from the report files, with flaky count 2", () => {
    const cli = path.resolve(__dirname, "../../scripts/summary/summary.ts");
    const dir = mkdtempSync(path.join(tmpdir(), "summary-page-"));
    try {
      for (const sub of ["coverage", "junit", "reports", "e2e-1/test-results", "e2e-2/test-results"]) mkdirSync(path.join(dir, sub), { recursive: true });
      writeFileSync(path.join(dir, "vitest.config.ts"), "thresholds: { lines: 84, functions: 83, branches: 72, statements: 83 }");
      writeFileSync(path.join(dir, "junit/junit.xml"), '<testsuites tests="7" failures="0" errors="0" skipped="1">');
      const p = (v: number) => ({ pct: v });
      writeFileSync(path.join(dir, "coverage/coverage-summary.json"), JSON.stringify({ total: { lines: p(90), functions: p(90), branches: p(60), statements: p(90) } }));
      writeFileSync(path.join(dir, "coverage/crap-summary.json"), '{"max":20,"functions":10,"over":3}');
      writeFileSync(path.join(dir, "reports/flaky-count.txt"), "2\n");
      writeFileSync(path.join(dir, "e2e-1/test-results/results.json"), JSON.stringify({ stats: { expected: 4, unexpected: 1, skipped: 2, flaky: 0 } }));
      writeFileSync(path.join(dir, "e2e-2/test-results/results.json"), JSON.stringify({ stats: { expected: 9, unexpected: 0, skipped: 0, flaky: 0 } }));
      const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", cli, "html", "page"], { cwd: dir, encoding: "utf8" });
      expect(result.status).toBe(0);
      const html = readFileSync(path.join(dir, "page/index.html"), "utf8");
      for (const expected of [
        "6 passed, 0 failed, 1 skipped",
        "<td>shard 1</td><td>❌</td><td>4 passed, 1 failed, 2 skipped</td>",
        "<td>shard 2</td><td>✅</td><td>9 passed, 0 failed, 0 skipped</td>",
        "<td>branches</td><td>60%</td><td>72%</td><td>❌ miss (12% below)</td>",
        "3 functions over CRAP_MAX (20) of 10 scored",
        "2 flaky tests",
      ]) {
        expect(html).toContain(expected);
      }
      // Without arguments the page goes to ci-summary/, and missing reports render as no data.
      rmSync(path.join(dir, "reports"), { recursive: true });
      expect(spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", cli, "html"], { cwd: dir, encoding: "utf8" }).status).toBe(0);
      expect(readFileSync(path.join(dir, "ci-summary/index.html"), "utf8")).toContain("not measured");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
