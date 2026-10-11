import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";
import playwrightConfig from "../../playwright.config";
import vitestConfig from "../../vitest.config";

type Step = { uses?: string; if?: string; with?: { name?: string; path?: string; "retention-days"?: number } };
type Job = { steps?: Step[] };

const REQUIRED_REPORTERS = ["html", "list", "allure-playwright", "json"];
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
    expect(reporterProblems({ reporter: [["html"], ["list"]] })).toEqual(["missing reporter allure-playwright", "missing reporter json"]);
    expect(reporterProblems({ reporter: [["html"], ["allure-playwright"], ["json"]] })).toEqual(["missing reporter list"]);
    expect(reporterProblems({ reporter: [["html"], ["list"], ["allure-playwright"], ["json"]] })).toEqual([]);
    expect(reporterProblems({ reporter: [["html"], ["list"], ["allure-playwright"]] })).toEqual(["missing reporter json"]);
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

type Config = { test?: { reporters?: unknown; coverage?: { reporter?: unknown } } };

const REQUIRED_VITEST_REPORTERS = ["allure-vitest/reporter", "junit"];
const REQUIRED_COVERAGE_REPORTERS = ["json", "json-summary", "lcov", "html"];

function entryNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((r) => (Array.isArray(r) ? String(r[0]) : String(r)));
}

/** One problem string per Vitest reporter or coverage reporter the config lost. */
function vitestProblems(config: Config): string[] {
  const reporters = entryNames(config.test?.reporters);
  const coverage = entryNames(config.test?.coverage?.reporter);
  return [
    ...REQUIRED_VITEST_REPORTERS.filter((r) => !reporters.includes(r)).map((r) => `missing reporter ${r}`),
    ...REQUIRED_COVERAGE_REPORTERS.filter((r) => !coverage.includes(r)).map((r) => `missing coverage reporter ${r}`),
  ];
}

const QUALITY_UPLOADS: Record<string, string> = {
  "unit Allure results": "allure-results-unit/",
  "JUnit file": "junit/junit.xml",
  coverage: "coverage/",
};

/** One problem string per quality-job upload that is missing or lost if: always(). */
function qualityUploadProblems(workflow: unknown): string[] {
  const job = (workflow as { jobs?: Record<string, Job> })?.jobs?.quality;
  if (!job) return ["no quality job"];
  const uploads = (job.steps ?? []).filter((s) => s.uses?.startsWith("actions/upload-artifact@"));
  const problems: string[] = [];
  for (const [label, wanted] of Object.entries(QUALITY_UPLOADS)) {
    const step = uploads.find((u) => (u.with?.path ?? "").split(/\s+/).includes(wanted));
    if (!step) problems.push(`no upload of ${label}`);
    else if (step.if?.trim() !== "always()") problems.push(`upload of ${label} must use if: always(), got ${step.if}`);
  }
  return problems;
}

describe("vitest.config.ts reporters", () => {
  it("writes Allure results, a JUnit file and json-summary/lcov/html/json coverage", () => {
    expect(vitestProblems(vitestConfig as Config)).toEqual([]);
  });

  it("flags a lost allure-vitest, JUnit or json-summary reporter (negative cases)", () => {
    const cfg = (reporters: unknown[], coverage: unknown[]): Config => ({ test: { reporters, coverage: { reporter: coverage } } });
    const cov = ["text", "json", "json-summary", "html", "lcov"];
    const rep = ["default", ["allure-vitest/reporter", {}], ["junit", {}]];
    expect(vitestProblems(cfg(rep, cov))).toEqual([]);
    expect(vitestProblems(cfg(rep.slice(0, 1).concat(rep.slice(2)), cov))).toEqual(["missing reporter allure-vitest/reporter"]);
    expect(vitestProblems(cfg(rep.slice(0, 2), cov))).toEqual(["missing reporter junit"]);
    expect(vitestProblems(cfg(rep, cov.filter((c) => c !== "json-summary")))).toEqual(["missing coverage reporter json-summary"]);
    expect(vitestProblems({ test: {} })).toHaveLength(6);
  });
});

describe("ci.yml quality report uploads", () => {
  it("uploads the unit Allure results, the JUnit file and coverage/ with if: always()", () => {
    expect(qualityUploadProblems(ci)).toEqual([]);
  });

  it("flags an upload that loses if: always() or goes missing (negative cases)", () => {
    const upload = (p: string, over: Partial<Step> = {}): Step => ({
      uses: "actions/upload-artifact@x",
      if: "always()",
      with: { path: p },
      ...over,
    });
    const paths = Object.values(QUALITY_UPLOADS);
    const wf = (steps: Step[]) => ({ jobs: { quality: { steps } } });
    const good = paths.map((p) => upload(p));
    expect(qualityUploadProblems(wf(good))).toEqual([]);
    for (let i = 0; i < paths.length; i++) {
      const swap = (s: Step) => wf(good.map((g, j) => (j === i ? s : g)));
      expect(qualityUploadProblems(swap(upload(paths[i], { if: "failure()" })))).toHaveLength(1);
      expect(qualityUploadProblems(swap(upload(paths[i], { if: undefined })))).toHaveLength(1);
      expect(qualityUploadProblems(wf(good.filter((_, j) => j !== i)))).toHaveLength(1);
    }
  });
});

/** Problems with the job-summary step of a job: it must run `scripts/summary/summary.ts <kind>` with `if: always()`. */
function summaryStepProblems(workflow: unknown, jobName: string, kind: string): string[] {
  const job = (workflow as { jobs?: Record<string, { steps?: (Step & { run?: string })[] }> })?.jobs?.[jobName];
  if (!job) return [`no ${jobName} job`];
  const step = (job.steps ?? []).find((s) => (s.run ?? "").includes("scripts/summary/summary.ts"));
  if (!step) return [`${jobName} has no job-summary step`];
  const problems: string[] = [];
  if (step.if?.trim() !== "always()") problems.push(`${jobName} job-summary step must use if: always(), got ${step.if}`);
  if (!new RegExp(`summary\\.ts\\s+${kind}\\b`).test(step.run ?? "")) problems.push(`${jobName} job-summary step must run the ${kind} summary`);
  return problems;
}

describe("ci.yml job summaries", () => {
  it("runs the summary CLI in the quality job and in each e2e shard with if: always()", () => {
    expect(summaryStepProblems(ci, "quality", "quality")).toEqual([]);
    expect(summaryStepProblems(ci, "e2e", "e2e")).toEqual([]);
    const e2eRun = (ci as { jobs: { e2e: { steps: { run?: string }[] } } }).jobs.e2e.steps.find((s) => s.run?.includes("summary.ts"))?.run;
    expect(e2eRun).toMatch(/\$\{\{\s*matrix\.shard\s*\}\}/);
  });

  it("flags a summary step that is missing, loses if: always() or runs the wrong summary (negative cases)", () => {
    const wf = (step: Record<string, unknown> | null) => ({ jobs: { quality: { steps: step ? [step] : [] } } });
    const good = { if: "always()", run: "node scripts/summary/summary.ts quality" };
    expect(summaryStepProblems(wf(good), "quality", "quality")).toEqual([]);
    expect(summaryStepProblems(wf(null), "quality", "quality")).toHaveLength(1);
    expect(summaryStepProblems(wf({ ...good, if: "failure()" }), "quality", "quality")).toHaveLength(1);
    expect(summaryStepProblems(wf({ run: good.run }), "quality", "quality")).toHaveLength(1);
    expect(summaryStepProblems(wf({ ...good, run: "node scripts/summary/summary.ts e2e 1/2" }), "quality", "quality")).toHaveLength(1);
  });
});

type ReportStep = Step & { run?: string };
type ReportJob = { needs?: unknown; if?: string; "runs-on"?: unknown; permissions?: Record<string, string>; steps?: ReportStep[] };

const REPORT_INPUTS = ["unit-allure-results", "e2e-allure-results-1", "e2e-allure-results-2"];

/** True when the artifact-name glob (`*` only) matches the whole name. */
function globMatches(glob: string, name: string): boolean {
  return new RegExp(`^${glob.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(name);
}

/** One problem string per way the `report` job deviates from: needs quality+e2e, always(), same runner, read-only, one Allure report uploaded always(). */
function reportJobProblems(workflow: unknown): string[] {
  const jobs = (workflow as { jobs?: Record<string, ReportJob> })?.jobs ?? {};
  const job = jobs.report;
  if (!job) return ["no report job"];
  const problems: string[] = [];
  const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
  for (const wanted of ["quality", "e2e"]) if (!needs.includes(wanted)) problems.push(`report must need ${wanted}`);
  if (!/(^|[^\w.])always\(\)/.test(job.if ?? "")) problems.push(`report must run with if: always(), got ${job.if}`);
  if (JSON.stringify(job["runs-on"]) !== JSON.stringify(jobs.quality?.["runs-on"])) problems.push("report must use the same runs-on as quality");
  if (JSON.stringify(job["runs-on"]) !== JSON.stringify(jobs.e2e?.["runs-on"])) problems.push("report must use the same runs-on as e2e");
  const permissions = job.permissions ?? {};
  for (const [scope, level] of Object.entries(permissions)) {
    if (!(scope === "contents" && level === "read")) problems.push(`report permission ${scope}: ${level} is wider than contents: read`);
  }
  const steps = job.steps ?? [];
  const download = steps.find((s) => s.uses?.startsWith("actions/download-artifact@"));
  const pattern = String((download as { with?: { pattern?: string } } | undefined)?.with?.pattern ?? "");
  if (!download) problems.push("report downloads no artifacts");
  for (const input of REPORT_INPUTS) if (!globMatches(pattern, input)) problems.push(`report download does not select ${input}`);
  if (!steps.some((s) => /\ballure\b[^\n]*\bgenerate\b/.test(s.run ?? ""))) problems.push("report has no allure generate step");
  const upload = steps.find((s) => s.uses?.startsWith("actions/upload-artifact@"));
  if (!upload) problems.push("report uploads no artifact");
  else if (upload.if?.trim() !== "always()") problems.push(`report upload must use if: always(), got ${upload.if}`);
  return problems;
}

describe("ci.yml report job", () => {
  it("merges the unit and e2e Allure results into one report artifact on every run", () => {
    expect(reportJobProblems(ci)).toEqual([]);
  });

  it("flags a report job that loses needs, if: always(), the upload's if: always() or read-only permissions (negative cases)", () => {
    const base = (): { jobs: Record<string, ReportJob> } => ({
      jobs: {
        quality: { "runs-on": ["a", "b"] },
        e2e: { "runs-on": ["a", "b"] },
        report: {
          needs: ["quality", "e2e"],
          if: "always() && github.event_name != 'x'",
          "runs-on": ["a", "b"],
          permissions: { contents: "read" },
          steps: [
            { uses: "actions/download-artifact@x", with: { pattern: "*allure-results*" } } as ReportStep,
            { run: "npx allure generate allure-input/* --output allure-report" },
            { uses: "actions/upload-artifact@x", if: "always()" },
          ],
        },
      },
    });
    expect(reportJobProblems(base())).toEqual([]);
    const mutate = (fn: (j: ReportJob) => void) => {
      const wf = base();
      fn(wf.jobs.report);
      return reportJobProblems(wf);
    };
    expect(mutate((j) => delete j.needs)).toHaveLength(2);
    expect(mutate((j) => (j.needs = ["quality"]))).toEqual(["report must need e2e"]);
    expect(mutate((j) => delete j.if)).toHaveLength(1);
    expect(mutate((j) => (j.if = "success()"))).toHaveLength(1);
    expect(mutate((j) => (j["runs-on"] = ["ubuntu-latest"]))).toHaveLength(2);
    expect(mutate((j) => (j.permissions = { contents: "write" }))).toHaveLength(1);
    expect(mutate((j) => (j.permissions = { contents: "read", actions: "read" }))).toHaveLength(1);
    expect(mutate((j) => delete (j.steps ?? [])[2].if)).toHaveLength(1);
    expect(mutate((j) => ((j.steps ?? [])[2].if = "success()"))).toHaveLength(1);
    expect(mutate((j) => j.steps?.pop())).toHaveLength(1);
    expect(mutate((j) => ((j.steps ?? [])[0] as { with: { pattern: string } }).with.pattern = "unit-*")).toHaveLength(2);
  });
});
