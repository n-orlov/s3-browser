// .github/workflows/macos-build.yml (SPEC section 5): the dispatch-only macOS leg of the Jenkins release flow. It builds
// the dmg from the release commit and uploads it to the DRAFT release by numeric id; nothing else may start it, it may
// not hold a write permission outside its one job, and it may not use an action that finds releases by tag.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, unknown> };
type Job = { "runs-on"?: unknown; permissions?: Record<string, string> | string | null; steps?: Step[] };
type Workflow = {
  name?: string;
  "run-name"?: string;
  on?: unknown;
  permissions?: unknown;
  jobs?: Record<string, Job>;
};

const FILE = path.resolve(__dirname, "../../.github/workflows/macos-build.yml");
const real = readFileSync(FILE, "utf8");
const INPUTS = ["tag", "sha", "release_id", "correlation_id"];

/** The real file text with one edit applied; throws if the edit did not apply. */
function edited(from: string | RegExp, to: string): string {
  const out = real.replace(from, to);
  if (out === real) throw new Error(`fixture edit ${String(from)} did not apply`);
  return out;
}

/** One problem string per way the workflow text deviates from the dispatch-only macOS release leg. */
function macosProblems(text: string): string[] {
  const problems: string[] = [];
  const wf = parse(text) as Workflow;
  const on = wf.on;
  const events = typeof on === "string" ? [on] : Array.isArray(on) ? on.map(String) : Object.keys((on as object) ?? {});
  if (events.length !== 1 || events[0] !== "workflow_dispatch") problems.push(`triggers are [${events.join(", ")}], expected only workflow_dispatch`);
  const inputs = Object.keys(((on as { workflow_dispatch?: { inputs?: object } })?.workflow_dispatch?.inputs) ?? {});
  for (const i of INPUTS) if (!inputs.includes(i)) problems.push(`input ${i} is missing`);
  if (!(wf["run-name"] ?? "").includes("inputs.correlation_id")) problems.push("run-name does not carry the correlation id");

  const top = wf.permissions;
  if (top === null || typeof top !== "object" || Object.keys(top).length !== 0) problems.push(`top-level permissions are ${JSON.stringify(top)}, expected {}`);

  const jobs = Object.values(wf.jobs ?? {});
  if (jobs.length !== 1) problems.push(`has ${jobs.length} jobs, expected 1`);
  const job = jobs[0];
  if (!job) return [...problems, "no job"];
  if (job["runs-on"] !== "macos-latest") problems.push(`runs-on is ${JSON.stringify(job["runs-on"])}, expected macos-latest`);
  const perms = job.permissions;
  if (typeof perms !== "object" || perms === null || perms.contents !== "write" || Object.keys(perms).length !== 1) problems.push(`job permissions are ${JSON.stringify(perms)}, expected only contents: write`);

  const steps = job.steps ?? [];
  const runs = steps.map((s) => s.run ?? "").join("\n");
  if (steps.some((s) => /softprops\/action-gh-release/.test(s.uses ?? ""))) problems.push("uploads with softprops/action-gh-release (finds releases by tag, not id)");
  if (!/releases\/\$RELEASE_ID["']?\b/.test(runs) || !/\bdraft\b/.test(runs)) problems.push("does not check that the release id is a draft");
  if (!/\$TAG\b/.test(runs) || !/\$SHA\b/.test(runs) || !/target_commitish/.test(runs)) problems.push("does not compare the draft's tag and sha");
  if (!/uploads\.github\.com\/repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID\/assets\?name=/.test(runs)) problems.push("does not upload to uploads.github.com/.../releases/<release_id>/assets");
  if (!/release\/\*\.dmg/.test(runs)) problems.push("does not upload release/*.dmg");
  const idx = (re: RegExp): number => steps.findIndex((s) => re.test(s.run ?? ""));
  const [ci, build, upload] = [idx(/\bnpm ci\b/), idx(/npx electron-builder --mac -p never/), idx(/uploads\.github\.com/)];
  const check = idx(/target_commitish/);
  if (ci < 0 || !/\bnpm run build\b/.test(runs) || build < 0) problems.push("does not run npm ci, npm run build and electron-builder --mac -p never");
  if (!(check >= 0 && check < ci && build < upload)) problems.push("steps are not in order: draft check, npm ci, build, upload");
  if (String(steps[build]?.env?.CSC_IDENTITY_AUTO_DISCOVERY) !== "false") problems.push("the build step does not set CSC_IDENTITY_AUTO_DISCOVERY: false");
  return problems;
}

describe("macos-build.yml", () => {
  it("is the dispatch-only macOS leg with the four inputs, a job-level write and an upload by release id", () => {
    expect(macosProblems(real)).toEqual([]);
  });

  it("names the workflow after the dispatched tag and correlation id", () => {
    const wf = parse(real) as Workflow;
    expect(wf.name).toBe("macos-build");
    expect(wf["run-name"]).toBe("macos-build ${{ inputs.tag }} [${{ inputs.correlation_id }}]");
  });

  const FIXTURES: Array<[string, string, RegExp]> = [
    ["a push trigger is added", edited(/on:\n {2}workflow_dispatch:/, "on:\n  push:\n    branches: [master]\n  workflow_dispatch:"), /triggers are \[push, workflow_dispatch\]/],
    ["contents: write moves to the top level", edited(/permissions: \{\}/, "permissions:\n  contents: write"), /top-level permissions/],
    ["the job gains a second permission", edited(/ {4}permissions:\n {6}contents: write/, "    permissions:\n      contents: write\n      actions: write"), /job permissions/],
    ["the job has no permissions", edited(/ {4}permissions:\n {6}contents: write\n/, ""), /job permissions/],
    ["the upload goes through softprops", edited(/ {6}- name: Upload the DMGs[\s\S]*$/, "      - name: Upload\n        uses: softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64 # v3.0.3\n        with:\n          files: release/*.dmg\n"), /softprops/],
    ["the release_id input is dropped", edited(/ {6}release_id:\n {8}description: [^\n]*\n {8}required: true\n/, ""), /input release_id is missing/],
    ["the correlation_id input is dropped", edited(/ {6}correlation_id:\n {8}description: [^\n]*\n {8}required: true\n/, ""), /input correlation_id is missing/],
    ["the run-name loses the correlation id", edited(/ \[\$\{\{ inputs\.correlation_id \}\}\]/, ""), /run-name/],
    ["the runner is ubuntu-latest", edited("runs-on: macos-latest", "runs-on: ubuntu-latest"), /runs-on/],
    ["the draft check is removed", edited(/ {6}- name: Check the release is a draft[\s\S]*?(?= {6}- name: Setup Node)/, ""), /draft/],
    ["the upload is addressed by tag", edited(/releases\/\$RELEASE_ID\/assets/, "releases/tags/$TAG/assets"), /releases\/<release_id>\/assets/],
    ["code signing discovery is left on", edited(/CSC_IDENTITY_AUTO_DISCOVERY: false/, "CSC_IDENTITY_AUTO_DISCOVERY: true"), /CSC_IDENTITY_AUTO_DISCOVERY/],
  ];

  it.each(FIXTURES)("is red when %s", (_name, text, expected) => {
    expect(macosProblems(text).join("\n")).toMatch(expected);
  });
});
