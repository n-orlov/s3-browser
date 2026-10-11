import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";
import playwrightConfig from "../../playwright.config";

type Step = { uses?: string; if?: string; with?: { name?: string; path?: string; "retention-days"?: number } };
type Job = { steps?: Step[] };

const REQUIRED_REPORTERS = ["html", "list", "allure-playwright"];
const REQUIRED_UPLOAD_PATHS = ["playwright-report/", "test-results/", "allure-results/"];

/** Names of the reporters a Playwright config declares. */
function reporterNames(config: { reporter?: unknown }): string[] {
  const reporter = config.reporter;
  if (!Array.isArray(reporter)) return [];
  return reporter.map((r) => (Array.isArray(r) ? String(r[0]) : String(r)));
}

function reporterProblems(config: { reporter?: unknown }): string[] {
  const names = reporterNames(config);
  return REQUIRED_REPORTERS.filter((r) => !names.includes(r)).map((r) => `missing reporter ${r}`);
}

/** One problem string per way the e2e uploads deviate from always-upload, 14 days, per-shard names. */
function uploadProblems(workflow: unknown): string[] {
  const job = (workflow as { jobs?: Record<string, Job> })?.jobs?.e2e;
  if (!job) return ["no e2e job"];
  const uploads = (job.steps ?? []).filter((s) => s.uses?.startsWith("actions/upload-artifact@"));
  const problems: string[] = [];
  for (const wanted of REQUIRED_UPLOAD_PATHS) {
    const step = uploads.find((u) => (u.with?.path ?? "").split(/\s+/).includes(wanted));
    if (!step) {
      problems.push(`no upload of ${wanted}`);
      continue;
    }
    if (step.if?.trim() !== "always()") problems.push(`upload of ${wanted} must use if: always(), got ${step.if}`);
    if (step.with?.["retention-days"] !== 14) problems.push(`upload of ${wanted} must keep 14 days`);
    if (!/\$\{\{\s*matrix\.shard\s*\}\}/.test(step.with?.name ?? "")) {
      problems.push(`upload of ${wanted} has no per-shard name`);
    }
  }
  return problems;
}

const root = path.resolve(__dirname, "../..");
const ci = parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));

describe("playwright.config.ts reporters", () => {
  it("writes html, list and Allure results", () => {
    expect(reporterProblems(playwrightConfig)).toEqual([]);
  });

  it("flags a removed allure-playwright or list reporter (negative cases)", () => {
    expect(reporterProblems({ reporter: [["html"], ["list"]] })).toEqual(["missing reporter allure-playwright"]);
    expect(reporterProblems({ reporter: [["html"], ["allure-playwright"]] })).toEqual(["missing reporter list"]);
    expect(reporterProblems({ reporter: [["html"], ["list"], ["allure-playwright"]] })).toEqual([]);
  });

  it("keeps the unchanged runtime settings", () => {
    expect(playwrightConfig.retries).toBe(0);
    expect(playwrightConfig.workers).toBe(1);
    expect(playwrightConfig.timeout).toBe(60000);
    expect(playwrightConfig.expect?.timeout).toBe(10000);
  });
});

describe("ci.yml e2e report uploads", () => {
  it("uploads the HTML report, test-results and Allure results per shard, always, for 14 days", () => {
    expect(uploadProblems(ci)).toEqual([]);
  });

  it("flags an upload that loses if: always(), the 14-day retention or the shard name (negative cases)", () => {
    const upload = (over: Record<string, unknown>, p: string): Step => ({
      uses: "actions/upload-artifact@x",
      if: "always()",
      ...over,
      with: { name: "x-${{ matrix.shard }}", path: p, "retention-days": 14, ...((over.with as object) ?? {}) },
    });
    const wf = (steps: Step[]) => ({ jobs: { e2e: { steps } } });
    const good = REQUIRED_UPLOAD_PATHS.map((p) => upload({}, p));
    expect(uploadProblems(wf(good))).toEqual([]);
    for (let i = 0; i < good.length; i++) {
      const swap = (s: Step) => wf(good.map((g, j) => (j === i ? s : g)));
      expect(uploadProblems(swap(upload({ if: "failure()" }, REQUIRED_UPLOAD_PATHS[i])))).not.toEqual([]);
      expect(uploadProblems(swap(upload({ if: undefined }, REQUIRED_UPLOAD_PATHS[i])))).not.toEqual([]);
      expect(uploadProblems(swap(upload({ with: { "retention-days": 7 } }, REQUIRED_UPLOAD_PATHS[i])))).not.toEqual([]);
      expect(uploadProblems(swap(upload({ with: { name: "fixed" } }, REQUIRED_UPLOAD_PATHS[i])))).not.toEqual([]);
    }
    expect(uploadProblems(wf(good.slice(1)))).not.toEqual([]);
  });
});
