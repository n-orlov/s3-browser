import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

type Step = { name?: string; uses?: string; run?: string };
type Job = { needs?: string | string[]; steps?: Step[] };
type Workflow = { jobs?: Record<string, Job> };

const root = path.resolve(__dirname, "../..");
const release = parse(readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8")) as Workflow;

const ANCESTOR = /git\s+merge-base\s+--is-ancestor\s+\S+\s+origin\/master\b/;
const isAncestorStep = (s: Step): boolean => ANCESTOR.test(s.run ?? "");
/** A step that builds or publishes: an upload action, or a command that installs, builds, packages or runs the Docker builder. */
const isBuildOrUploadStep = (s: Step): boolean =>
  /^(softprops\/action-gh-release|actions\/upload-artifact)@/.test(s.uses ?? "") ||
  /\b(npm\s+(ci|run\s+build|run\s+package\S*)|electron-builder|docker\s+run)\b/.test(s.run ?? "");

const stepsOf = (job: Job | undefined): Step[] => job?.steps ?? [];
const needsOf = (job: Job | undefined): string[] => [job?.needs ?? []].flat();

/** True when `job` depends on `target`, directly or through other jobs. */
function dependsOn(wf: Workflow, job: string, target: string, seen = new Set<string>()): boolean {
  if (seen.has(job)) return false;
  seen.add(job);
  return needsOf(wf.jobs?.[job]).some((n) => n === target || dependsOn(wf, n, target, seen));
}

/** One problem per way the release workflow deviates from "no build or upload before the release commit is proven to be on master". */
function releaseGateProblems(wf: Workflow): string[] {
  const jobs = wf.jobs ?? {};
  const gates = Object.keys(jobs).filter((j) => stepsOf(jobs[j]).some(isAncestorStep));
  if (gates.length === 0) return ["no job runs `git merge-base --is-ancestor <sha> origin/master`"];
  const gate = gates[0];
  const problems: string[] = [];
  const steps = stepsOf(jobs[gate]);
  if (!steps.some((s) => /git\s+fetch\s+origin\s+master\b/.test(s.run ?? ""))) problems.push(`${gate} does not run \`git fetch origin master\``);
  const check = steps.findIndex(isAncestorStep);
  const early = steps.findIndex(isBuildOrUploadStep);
  if (early >= 0 && early < check) problems.push(`${gate} runs a build or upload step ("${steps[early].name ?? steps[early].uses ?? steps[early].run}") before the ancestor check`);
  const builders = Object.keys(jobs).filter((j) => j !== gate && stepsOf(jobs[j]).some(isBuildOrUploadStep));
  if (builders.length === 0) problems.push("no build or upload job found");
  for (const j of builders) {
    if (!dependsOn(wf, j, gate)) problems.push(`${j} does not need ${gate}`);
  }
  return problems;
}

const clone = (wf: Workflow): Workflow => JSON.parse(JSON.stringify(wf)) as Workflow;

describe("release workflow ancestor gate", () => {
  it("has the ancestor check, run before any build or upload, and every build job needs it", () => {
    expect(releaseGateProblems(release)).toEqual([]);
  });

  it("covers all three build jobs", () => {
    const jobs = release.jobs ?? {};
    const gate = Object.keys(jobs).find((j) => stepsOf(jobs[j]).some(isAncestorStep)) ?? "";
    expect(gate).not.toBe("");
    for (const j of ["build-linux", "build-windows", "build-macos"]) {
      expect(jobs[j], j).toBeDefined();
      expect(dependsOn(release, j, gate), `${j} needs ${gate}`).toBe(true);
    }
  });

  it("reports a problem when the ancestor step is removed", () => {
    const wf = clone(release);
    for (const job of Object.values(wf.jobs ?? {})) {
      job.steps = stepsOf(job).filter((s) => !isAncestorStep(s));
    }
    expect(releaseGateProblems(wf)).toContain("no job runs `git merge-base --is-ancestor <sha> origin/master`");
  });

  it("reports a problem for each build job whose needs is dropped", () => {
    for (const j of ["build-linux", "build-windows", "build-macos"]) {
      const wf = clone(release);
      delete (wf.jobs ?? {})[j].needs;
      const problems = releaseGateProblems(wf);
      expect(problems.length, j).toBe(1);
      expect(problems[0]).toMatch(new RegExp(`^${j} does not need `));
    }
  });

  it("reports a problem when the check is moved after an upload step", () => {
    const wf = clone(release);
    const gate = Object.values(wf.jobs ?? {}).find((job) => stepsOf(job).some(isAncestorStep));
    const upload: Step = { name: "Upload", uses: "softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64" };
    const [checkout, ...rest] = stepsOf(gate);
    if (gate) gate.steps = [checkout, upload, ...rest];
    expect(releaseGateProblems(wf).join("\n")).toMatch(/before the ancestor check/);
  });

  it("reports a problem when the fetch of origin/master is missing", () => {
    const wf = clone(release);
    for (const s of Object.values(wf.jobs ?? {}).flatMap(stepsOf)) {
      if (s.run) s.run = s.run.replace(/git fetch origin master/g, "true");
    }
    expect(releaseGateProblems(wf).join("\n")).toMatch(/git fetch origin master/);
  });
});
