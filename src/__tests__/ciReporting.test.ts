import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { spawn } from "child_process";
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

type PublishJob = ReportJob & { name?: string };
type Workflow = { permissions?: Record<string, string>; jobs?: Record<string, PublishJob> };

const PAGES_URL = "https://n-orlov.github.io/s3-browser/";
const PUSH_STEP = /\bgit\s+push\b/;

/** True when `condition` is a conjunction (no `||`) that includes the given `==` comparison. */
function requires(condition: string, left: string, right: string): boolean {
  if (condition.includes("||")) return false;
  const clause = new RegExp(`(^|&&)\\s*${left.replace(/\./g, "\\.")}\\s*==\\s*'${right.replace(/[/]/g, "\\/")}'\\s*(&&|$)`);
  return clause.test(condition.replace(/\s+/g, " ").trim());
}

/** Jobs a pull_request event can reach: every job whose condition does not require a push event. */
function pullRequestReachableJobs(workflow: Workflow): string[] {
  return Object.entries(workflow.jobs ?? {})
    .filter(([, job]) => !requires(job.if ?? "", "github.event_name", "push"))
    .map(([name]) => name);
}

/** One problem per reachable job holding a permission wider than read (job-level, else the workflow's). */
function pullRequestWritePermissionProblems(workflow: Workflow): string[] {
  const problems: string[] = [];
  for (const name of pullRequestReachableJobs(workflow)) {
    const job = workflow.jobs?.[name] ?? {};
    for (const [scope, level] of Object.entries(job.permissions ?? workflow.permissions ?? {})) {
      if (level !== "read" && level !== "none") problems.push(`${name} is reachable from a pull request but has ${scope}: ${level}`);
    }
  }
  return problems;
}

/** One problem per way the job holding the gh-pages push deviates from: separate from report, push-to-master only, contents: write, links the site. */
function publishJobProblems(workflow: Workflow): string[] {
  const jobs = workflow.jobs ?? {};
  const entry = Object.entries(jobs).find(([, job]) => (job.steps ?? []).some((s) => PUSH_STEP.test(s.run ?? "")));
  if (!entry) return ["no job pushes the report to gh-pages"];
  const [name, job] = entry;
  const problems: string[] = [];
  if (name === "report") problems.push("the publish step must not sit in the report job");
  const pushStep = (job.steps ?? []).find((s) => PUSH_STEP.test(s.run ?? ""));
  const condition = `${job.if ?? ""} && ${pushStep?.if ?? ""}`.replace(/(^\s*&&\s*)|(\s*&&\s*$)/g, "");
  if (!requires(condition, "github.event_name", "push")) problems.push(`${name} must require github.event_name == 'push'`);
  if (!requires(condition, "github.ref", "refs/heads/master")) problems.push(`${name} must require github.ref == 'refs/heads/master'`);
  if (job.permissions?.contents !== "write") problems.push(`${name} needs permissions contents: write, got ${job.permissions?.contents}`);
  if (!pushStep?.run?.includes("gh-pages")) problems.push("the push must target gh-pages");
  const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
  if (!needs.includes("report")) problems.push(`${name} must need report`);
  if (!(job.steps ?? []).some((s) => s.run?.includes(PAGES_URL) && s.run.includes("GITHUB_STEP_SUMMARY"))) {
    problems.push(`${name} must link ${PAGES_URL} in its job summary`);
  }
  return problems;
}

/** The report job must seed allure-report/history.jsonl from the gh-pages branch before generating. */
function historyProblems(workflow: Workflow): string[] {
  const steps = workflow.jobs?.report?.steps ?? [];
  const problems: string[] = [];
  const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout@") && (s as { with?: { ref?: string } }).with?.ref === "gh-pages");
  if (!checkout) problems.push("report does not check out gh-pages for the previous history");
  const generate = steps.findIndex((s) => /\ballure\b[^\n]*\bgenerate\b/.test(s.run ?? ""));
  const copy = steps.findIndex((s) => /previous-pages\/history\.jsonl/.test(s.run ?? ""));
  if (copy < 0 || generate < 0 || copy > generate || !/previous-pages\/history\.jsonl[^\n]*allure-report/.test(steps[copy]?.run ?? "")) {
    problems.push("report must copy the previous history.jsonl into allure-report before generating");
  }
  return problems;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

describe("ci.yml publish job", () => {
  it("pushes the merged report to gh-pages only for a push to master, from a job with contents: write", () => {
    expect(publishJobProblems(ci)).toEqual([]);
    expect((ci as Workflow).jobs?.publish).toBeDefined();
  });

  it("carries the previous Allure history forward through the report job and the config", () => {
    expect(historyProblems(ci)).toEqual([]);
    const config = readFileSync(path.join(root, "scripts/allurerc.mjs"), "utf8");
    expect(config).toMatch(/appendHistory:\s*true/);
    expect(config).toMatch(/historyPath:\s*'\.\/allure-report\/history\.jsonl'/);
  });

  it("gives no job reachable from a pull_request any write permission, and the publish job is not reachable", () => {
    expect(pullRequestWritePermissionProblems(ci)).toEqual([]);
    expect(pullRequestReachableJobs(ci)).not.toContain("publish");
    expect(pullRequestReachableJobs(ci)).toEqual(expect.arrayContaining(["quality", "e2e", "report"]));
  });

  it("flags a publish step that loses its push-to-master condition, its write permission or its separate job (negative cases)", () => {
    const mutate = (fn: (wf: Workflow) => void) => {
      const wf = clone(ci) as Workflow;
      fn(wf);
      return publishJobProblems(wf);
    };
    const publish = (wf: Workflow) => wf.jobs!.publish;
    expect(mutate((wf) => delete publish(wf).if)).toHaveLength(2);
    expect(mutate((wf) => (publish(wf).if = "github.event_name == 'push'"))).toEqual(["publish must require github.ref == 'refs/heads/master'"]);
    expect(mutate((wf) => (publish(wf).if = "github.ref == 'refs/heads/master'"))).toEqual(["publish must require github.event_name == 'push'"]);
    expect(mutate((wf) => (publish(wf).if = "github.event_name == 'push' || github.ref == 'refs/heads/master'"))).toHaveLength(2);
    expect(mutate((wf) => (publish(wf).permissions = { contents: "read" }))).toHaveLength(1);
    expect(mutate((wf) => delete publish(wf).permissions)).toHaveLength(1);
    expect(mutate((wf) => delete publish(wf).needs)).toEqual(["publish must need report"]);
    expect(mutate((wf) => (publish(wf).steps = publish(wf).steps!.filter((s) => !s.run?.includes(PAGES_URL))))).toHaveLength(1);
    // Moving the publish step into the pull-request-reachable report job is flagged.
    expect(mutate((wf) => {
      wf.jobs!.report.steps!.push(...publish(wf).steps!);
      delete wf.jobs!.publish;
    })).toContain("the publish step must not sit in the report job");
    // A step-level condition can stand in for the job-level one.
    expect(mutate((wf) => {
      const step = publish(wf).steps!.find((s) => PUSH_STEP.test(s.run ?? ""))!;
      step.if = publish(wf).if;
      delete publish(wf).if;
    })).toEqual([]);
  });

  it("flags a write permission on any job a pull_request can reach (negative cases)", () => {
    const mutate = (fn: (wf: Workflow) => void) => {
      const wf = clone(ci) as Workflow;
      fn(wf);
      return pullRequestWritePermissionProblems(wf);
    };
    expect(mutate((wf) => (wf.jobs!.report.permissions = { contents: "write" }))).toEqual(["report is reachable from a pull request but has contents: write"]);
    expect(mutate((wf) => (wf.jobs!.quality.permissions = { "pull-requests": "write" }))).toHaveLength(1);
    expect(mutate((wf) => (wf.permissions = { contents: "write" }))).toHaveLength(2);
    // Dropping the push condition from publish makes it reachable from a pull request while it holds contents: write.
    expect(mutate((wf) => delete wf.jobs!.publish.if)).toEqual(["publish is reachable from a pull request but has contents: write"]);
    expect(mutate((wf) => (wf.jobs!.publish.if = "github.event_name == 'push' || github.event_name == 'pull_request'"))).toHaveLength(1);
  });

  it("flags a report job that loses the previous-history seeding (negative cases)", () => {
    const mutate = (fn: (steps: ReportStep[]) => void) => {
      const wf = clone(ci) as Workflow;
      fn(wf.jobs!.report.steps!);
      return historyProblems(wf);
    };
    expect(mutate((steps) => steps.splice(steps.findIndex((s) => (s as { with?: { ref?: string } }).with?.ref === "gh-pages"), 1))).toHaveLength(1);
    expect(mutate((steps) => steps.splice(steps.findIndex((s) => /previous-pages/.test(s.run ?? "")), 1))).toHaveLength(1);
  });
});

type GateStep = { run?: string; env?: Record<string, string> };
type GateJob = { needs?: string | string[]; if?: string; steps?: GateStep[] };

/** One problem per way the gate job stops being the single all-or-nothing status. */
function gateProblems(workflow: unknown): string[] {
  const job = (workflow as { jobs?: Record<string, GateJob> })?.jobs?.gate;
  if (!job) return ["no gate job"];
  const problems: string[] = [];
  const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
  for (const wanted of GATE_NEEDS) if (!needs.includes(wanted)) problems.push(`gate must need ${wanted}`);
  if (job.if?.trim() !== "always()") problems.push(`gate must use if: always(), got ${job.if}`);
  const text = JSON.stringify(job.steps ?? []);
  for (const wanted of GATE_NEEDS) {
    if (!new RegExp(`needs\\.${wanted}\\.result`).test(text)) problems.push(`gate must check needs.${wanted}.result`);
  }
  return problems;
}

const GATE_NEEDS = ["quality", "e2e", "changes", "release-dryrun"];
type GateResults = Record<string, string>;
const PASSING: GateResults = { quality: "success", e2e: "success", changes: "success", "release-dryrun": "success" };

/** Runs the gate step's script the way Actions would, with the needs' results in its environment; returns the exit code. */
function runGate(workflow: unknown, results: GateResults): Promise<number> {
  const step = (workflow as { jobs: { gate: GateJob } }).jobs.gate.steps?.find((s) => s.run);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(step?.env ?? {})) {
    env[name] = value.replace(/\$\{\{\s*needs\.([\w-]+)\.result\s*\}\}/, (_, need: string) => results[need] ?? "");
  }
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-e", "-c", step?.run ?? "exit 99"], { env: { PATH: process.env.PATH ?? "", ...env }, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
}

describe("ci.yml gate job", () => {
  it("needs quality and e2e, always runs and checks both results", () => {
    expect(gateProblems(ci)).toEqual([]);
  });

  it("flags a gate that loses a need, if: always() or a result check (negative cases)", () => {
    const mutate = (fn: (job: GateJob) => void) => {
      const wf = clone(ci) as { jobs: { gate: GateJob } };
      fn(wf.jobs.gate);
      return gateProblems(wf);
    };
    expect(mutate((j) => (j.needs = ["quality", "changes", "release-dryrun"]))).toEqual(["gate must need e2e"]);
    expect(mutate((j) => (j.needs = ["e2e", "changes", "release-dryrun"]))).toEqual(["gate must need quality"]);
    expect(mutate((j) => (j.needs = ["quality", "e2e", "release-dryrun"]))).toEqual(["gate must need changes"]);
    expect(mutate((j) => delete j.needs)).toHaveLength(GATE_NEEDS.length);
    expect(mutate((j) => delete j.if)).toHaveLength(1);
    expect(mutate((j) => (j.if = "success()"))).toHaveLength(1);
    expect(mutate((j) => (j.if = "always() && github.event_name == 'push'"))).toHaveLength(1);
    expect(mutate((j) => delete j.steps![0].env!.E2E_RESULT)).toEqual(["gate must check needs.e2e.result"]);
    expect(mutate((j) => delete j.steps![0].env!.QUALITY_RESULT)).toEqual(["gate must check needs.quality.result"]);
    expect(mutate((j) => delete j.steps![0].env!.CHANGES_RESULT)).toEqual(["gate must check needs.changes.result"]);
    expect(mutate((j) => delete j.steps)).toHaveLength(GATE_NEEDS.length);
    expect(gateProblems({ jobs: {} })).toEqual(["no gate job"]);
  });

  it("passes only when quality, e2e and changes must each be success (release-dryrun's own cases are in ciReleaseDryrun.test.ts)", async () => {
    // The cases run concurrently: each is one bash process, and run one after another they exceed the test timeout on a loaded runner.
    const cases: Array<{ label: string; results: GateResults; code: Promise<number> }> = [];
    const add = (label: string, results: GateResults) => cases.push({ label, results, code: runGate(ci, results) });
    add("all success", PASSING);
    for (const need of ["quality", "e2e", "changes"]) {
      for (const bad of ["failure", "cancelled", "skipped"]) add(`${need} ${bad}`, { ...PASSING, [need]: bad });
    }
    add("quality failure and e2e cancelled", { ...PASSING, quality: "failure", e2e: "cancelled" });
    const codes = await Promise.all(cases.map((c) => c.code));
    expect(codes[0]).toBe(0);
    cases.slice(1).forEach((c, i) => expect(codes[i + 1], c.label).not.toBe(0));
  });
});

type TriggerWorkflow = {
  on?: { push?: { branches?: string[]; paths?: string[] }; pull_request?: { types?: string[]; branches?: string[] } };
  concurrency?: { group?: string; "cancel-in-progress"?: string };
  jobs?: Record<string, { if?: string }>;
};

const PR_TYPES = ["opened", "synchronize", "reopened", "ready_for_review"];
const PR_ARM =
  "github.event_name != 'pull_request' || (github.event.pull_request.head.repo.full_name == github.repository && " +
  "github.event.pull_request.user.login == 'n-orlov' && github.actor == 'n-orlov' && github.event.pull_request.draft == false)";
const GUARDED_JOBS = ["quality", "changes", "release-dryrun", "e2e", "report"];

/** One problem per way the triggers deviate from: pull_request opened/synchronize/reopened/ready_for_review into master, push to master without paths. */
function triggerProblems(workflow: TriggerWorkflow): string[] {
  const problems: string[] = [];
  const pr = workflow.on?.pull_request;
  if (JSON.stringify(pr?.types) !== JSON.stringify(PR_TYPES)) problems.push(`pull_request types must be ${PR_TYPES.join(", ")}, got ${JSON.stringify(pr?.types)}`);
  if (JSON.stringify(pr?.branches) !== JSON.stringify(["master"])) problems.push(`pull_request branches must be [master], got ${JSON.stringify(pr?.branches)}`);
  const push = workflow.on?.push;
  if (JSON.stringify(push?.branches) !== JSON.stringify(["master"])) problems.push(`push branches must be [master], got ${JSON.stringify(push?.branches)}`);
  if (push?.paths !== undefined) problems.push("push must not filter by paths");
  return problems;
}

/** The condition with the folded YAML whitespace collapsed, so it can be compared as one line. */
const flat = (condition: string | undefined) => (condition ?? "").replace(/\s+/g, " ").trim();

/** One problem per guarded job whose `if:` lacks the owner gate with the draft guard inside the pull_request arm. */
function draftGuardProblems(workflow: TriggerWorkflow): string[] {
  const problems: string[] = [];
  for (const name of GUARDED_JOBS) {
    const condition = flat(workflow.jobs?.[name]?.if);
    if (!condition) problems.push(`${name} has no if:`);
    else if (!condition.includes(PR_ARM)) problems.push(`${name} must carry the owner gate and the draft guard in the pull_request arm, got ${condition}`);
  }
  return problems;
}

/** One problem per way the concurrency group or the cancel rule changed. */
function concurrencyProblems(workflow: TriggerWorkflow): string[] {
  const problems: string[] = [];
  if (workflow.concurrency?.group !== "ci-${{ github.event.pull_request.number || github.ref }}") problems.push(`concurrency group changed: ${workflow.concurrency?.group}`);
  if (workflow.concurrency?.["cancel-in-progress"] !== "${{ github.event_name == 'pull_request' }}") problems.push(`cancel-in-progress changed: ${workflow.concurrency?.["cancel-in-progress"]}`);
  return problems;
}

describe("ci.yml branch workflow (draft pull requests, master only)", () => {
  const workflow = ci as TriggerWorkflow;
  const mutate = (fn: (wf: TriggerWorkflow) => void) => {
    const wf = clone(workflow);
    fn(wf);
    return wf;
  };

  it("runs on pull_request types opened, synchronize, reopened and ready_for_review into master, and on push to master, never main", () => {
    expect(triggerProblems(workflow)).toEqual([]);
    expect(workflow.on?.pull_request?.types).toEqual(PR_TYPES);
    expect(JSON.stringify(workflow.on)).not.toMatch(/\bmain\b/);
  });

  it("flags a dropped ready_for_review, a main branch or a paths filter on the triggers (negative cases)", () => {
    expect(triggerProblems(mutate((wf) => (wf.on!.pull_request!.types = ["opened", "synchronize", "reopened"])))).toHaveLength(1);
    expect(triggerProblems(mutate((wf) => delete wf.on!.pull_request!.types))).toHaveLength(1);
    expect(triggerProblems(mutate((wf) => (wf.on!.pull_request!.branches = ["master", "main"])))).toHaveLength(1);
    expect(triggerProblems(mutate((wf) => (wf.on!.push!.branches = ["master", "main"])))).toHaveLength(1);
    expect(triggerProblems(mutate((wf) => (wf.on!.push!.paths = ["src/**"])))).toHaveLength(1);
  });

  it("puts the draft guard beside the owner gate on quality, changes, release-dryrun, e2e and report", () => {
    expect(draftGuardProblems(workflow)).toEqual([]);
    for (const name of GUARDED_JOBS) expect(flat(workflow.jobs?.[name]?.if), name).toContain("github.event.pull_request.draft == false");
  });

  it("flags a job that loses the draft guard, an owner clause, or takes the guard out of the pull_request arm (negative cases)", () => {
    for (const name of GUARDED_JOBS) {
      const without = mutate((wf) => (wf.jobs![name].if = flat(wf.jobs![name].if).replace(" && github.event.pull_request.draft == false", "")));
      expect(draftGuardProblems(without), name).toHaveLength(1);
      const noActor = mutate((wf) => (wf.jobs![name].if = flat(wf.jobs![name].if).replace(" && github.actor == 'n-orlov'", "")));
      expect(draftGuardProblems(noActor), name).toHaveLength(1);
      const outside = mutate((wf) => (wf.jobs![name].if = `github.event.pull_request.draft == false && (${flat(wf.jobs![name].if).replace(" && github.event.pull_request.draft == false", "")})`));
      expect(draftGuardProblems(outside), name).toHaveLength(1);
      expect(draftGuardProblems(mutate((wf) => delete wf.jobs![name].if)), name).toHaveLength(1);
    }
  });

  it("leaves push, schedule and workflow_dispatch unguarded: the guard sits only inside the pull_request arm", () => {
    for (const name of GUARDED_JOBS) {
      const condition = flat(workflow.jobs?.[name]?.if);
      expect(condition.indexOf("github.event_name != 'pull_request' ||"), name).toBeGreaterThanOrEqual(0);
      expect(condition.indexOf("github.event.pull_request.draft"), name).toBeGreaterThan(condition.indexOf("github.event_name != 'pull_request' ||"));
    }
  });

  it("keeps publish push-to-master only and gate always() with no draft guard", () => {
    expect(flat(workflow.jobs?.publish?.if)).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'");
    expect(workflow.jobs?.gate?.if).toBe("always()");
    expect(publishJobProblems(workflow as Workflow)).toEqual([]);
    const loosened = mutate((wf) => (wf.jobs!.publish.if = "github.event_name == 'push' || github.event_name == 'pull_request'"));
    expect(publishJobProblems(loosened as Workflow)).not.toEqual([]);
  });

  it("keeps the concurrency group and the cancel-in-progress rule", () => {
    expect(concurrencyProblems(workflow)).toEqual([]);
    expect(concurrencyProblems(mutate((wf) => (wf.concurrency!.group = "ci-${{ github.ref }}")))).toHaveLength(1);
    expect(concurrencyProblems(mutate((wf) => (wf.concurrency!["cancel-in-progress"] = "false")))).toHaveLength(1);
    expect(concurrencyProblems(mutate((wf) => delete wf.concurrency))).toHaveLength(2);
  });
});
