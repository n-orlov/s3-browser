import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

type Step = { uses?: string; with?: Record<string, unknown> };
type Job = {
  if?: string;
  "runs-on"?: unknown;
  permissions?: Record<string, string>;
  steps?: Step[];
};
type Workflow = {
  on?: {
    push?: { branches?: string[] };
    pull_request?: unknown;
    schedule?: { cron?: string }[];
  };
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
};

const OWNER_GATE = [
  "github.event.pull_request.head.repo.full_name == github.repository",
  "github.event.pull_request.user.login == 'n-orlov'",
  "github.actor == 'n-orlov'",
];

const stepWith = (job: Job, action: string): Record<string, unknown> =>
  job.steps?.find((s) => s.uses?.startsWith(`github/codeql-action/${action}@`))?.with ?? {};

/** One problem string per way the workflow's triggers deviate from push to master + pull_request + weekly schedule. */
function triggerProblems(wf: Workflow): string[] {
  const problems: string[] = [];
  if (!wf.on?.push?.branches?.includes("master")) problems.push("no push trigger on master");
  if (!wf.on?.pull_request) problems.push("no pull_request trigger");
  const cron = wf.on?.schedule?.[0]?.cron;
  if (!cron || cron.trim().split(/\s+/).length !== 5) problems.push("no weekly schedule cron");
  else if (cron.trim().split(/\s+/)[4] === "*") problems.push("schedule cron is not weekly (day-of-week is *)");
  return problems;
}

/** One problem string per way the jobs deviate from the analysis configuration and write-permission placement. */
function jobProblems(wf: Workflow): string[] {
  const problems: string[] = [];
  const entries = Object.entries(wf.jobs ?? {});
  if (entries.length === 0) return ["no jobs"];
  if (Object.values(wf.permissions ?? {}).some((p) => p === "write")) {
    problems.push("top-level permissions grant write");
  }
  for (const [name, job] of entries) {
    if (job["runs-on"] !== "ubuntu-latest") problems.push(`${name}: not on ubuntu-latest`);
    const init = stepWith(job, "init");
    if (init.languages !== "javascript-typescript") problems.push(`${name}: language is not javascript-typescript`);
    if (init.queries !== "security-extended") problems.push(`${name}: queries is not security-extended`);
  }
  const writers = entries.filter(([, j]) => j.permissions?.["security-events"] === "write");
  if (writers.length !== 1) problems.push(`expected exactly one job with security-events: write, got ${writers.length}`);
  for (const [name, job] of entries) {
    const isWriter = writers.some(([n]) => n === name);
    const uploads = stepWith(job, "analyze").upload !== "never";
    if (isWriter !== uploads) problems.push(`${name}: security-events: write must be on exactly the job that uploads`);
    const gate = job.if ?? "";
    if (isWriter && !/github\.event_name\s*!=\s*'pull_request'/.test(gate)) {
      problems.push(`${name}: the uploading job's if: does not exclude pull_request`);
    }
    if (!isWriter) {
      if (!/github\.event_name\s*==\s*'pull_request'/.test(gate)) problems.push(`${name}: not limited to pull_request`);
      for (const clause of OWNER_GATE) {
        if (!gate.includes(clause)) problems.push(`${name}: if: lacks the owner gate clause ${clause}`);
      }
    }
  }
  return problems;
}

const file = path.resolve(__dirname, "../../.github/workflows/codeql.yml");
const text = readFileSync(file, "utf8");
const workflow = parse(text) as Workflow;

describe("codeql.yml", () => {
  it("is triggered by a push to master, pull_request and a weekly schedule", () => {
    expect(triggerProblems(workflow)).toEqual([]);
  });

  it("fails the trigger check when the schedule trigger is removed (negative case)", () => {
    const { schedule: _removed, ...on } = workflow.on ?? {};
    void _removed;
    const problems = triggerProblems({ ...workflow, on });
    expect(problems).toContain("no weekly schedule cron");
  });

  it("fails the trigger check when the push or pull_request trigger is removed (negative cases)", () => {
    const { push: _push, ...noPush } = workflow.on ?? {};
    const { pull_request: _pr, ...noPr } = workflow.on ?? {};
    void _push;
    void _pr;
    expect(triggerProblems({ ...workflow, on: noPush })).toContain("no push trigger on master");
    expect(triggerProblems({ ...workflow, on: noPr })).toContain("no pull_request trigger");
  });

  it("analyses javascript-typescript with the security-extended suite on ubuntu-latest, with write only on the uploading job", () => {
    expect(jobProblems(workflow)).toEqual([]);
  });

  it("keeps security-events: write at job level only", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    const lines = text.split("\n");
    const hits = lines.filter((l) => /security-events:\s*write/.test(l) && !l.trim().startsWith("#"));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^ {6}security-events: write$/);
  });

  it("flags a write permission on the pull-request job, a missing upload: never and a missing query suite (negative cases)", () => {
    const jobs = workflow.jobs ?? {};
    const pr = jobs["analyze-pr"];
    const withWrite = { ...workflow, jobs: { ...jobs, "analyze-pr": { ...pr, permissions: { "security-events": "write" } } } };
    expect(jobProblems(withWrite)).not.toEqual([]);
    const upload = {
      ...pr,
      steps: pr.steps?.map((s) =>
        s.uses?.includes("/analyze@") ? { ...s, with: { ...s.with, upload: "always" } } : s,
      ),
    };
    expect(jobProblems({ ...workflow, jobs: { ...jobs, "analyze-pr": upload } })).not.toEqual([]);
    const noQueries = {
      ...pr,
      steps: pr.steps?.map((s) => (s.uses?.includes("/init@") ? { ...s, with: { languages: "javascript-typescript" } } : s)),
    };
    expect(jobProblems({ ...workflow, jobs: { ...jobs, "analyze-pr": noQueries } })).not.toEqual([]);
    expect(jobProblems({ ...workflow, permissions: { "security-events": "write" } })).not.toEqual([]);
  });

  it("flags an uploading job that a pull_request can reach (negative case)", () => {
    const jobs = workflow.jobs ?? {};
    const reachable = { ...jobs.analyze, if: undefined };
    expect(jobProblems({ ...workflow, jobs: { ...jobs, analyze: reachable } })).not.toEqual([]);
  });

  it("flags a pull-request job without the owner gate (negative case)", () => {
    const jobs = workflow.jobs ?? {};
    const open = { ...jobs["analyze-pr"], if: "github.event_name == 'pull_request'" };
    expect(jobProblems({ ...workflow, jobs: { ...jobs, "analyze-pr": open } })).not.toEqual([]);
  });
});
