import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { "runs-on"?: unknown; permissions?: unknown; steps?: Step[] };
type Workflow = { permissions?: unknown; jobs?: Record<string, Job> };

const root = path.resolve(__dirname, "../..");
const load = (rel: string) => parse(readFileSync(path.join(root, rel), "utf8")) as Workflow;

const BUILD_COMMAND = /^(npm ci\b|npm run build\b|npx electron-builder\b)/;

/** The install/build/package commands of a job, in order, one per line of its `run:` steps. */
function buildCommands(job: Job | undefined): string[] {
  return (job?.steps ?? [])
    .flatMap((s) => (s.run ?? "").split("\n"))
    .map((l) => l.trim())
    .filter((l) => BUILD_COMMAND.test(l));
}

/** True when a `permissions:` value grants any write scope. */
function holdsWrite(p: unknown): boolean {
  if (typeof p === "string") return p === "write-all";
  if (p === null || typeof p !== "object") return false;
  return Object.values(p).some((v) => v === "write");
}

const WRONG_COMMANDS = "dry-run build commands differ from release.yml build-linux";

/** One problem per way the dry-run job deviates from the release build-linux job. */
function problems(ci: Workflow, release: Workflow): string[] {
  const out: string[] = [];
  const job = ci.jobs?.["release-dryrun"];
  if (!job) return ["ci.yml has no release-dryrun job"];
  const expected = buildCommands(release.jobs?.["build-linux"]);
  if (expected.length === 0) out.push("release.yml build-linux has no build commands");
  if (JSON.stringify(buildCommands(job)) !== JSON.stringify(expected)) out.push(WRONG_COMMANDS);
  if (holdsWrite(ci.permissions) || holdsWrite(job.permissions)) out.push("dry-run job holds a write permission");
  const runsOn = JSON.stringify(job["runs-on"]);
  if (runsOn !== JSON.stringify(["self-hosted", "linux", "x64", "s3-browser"])) out.push("dry-run job is not on the s3-browser runner");
  const upload = (job.steps ?? []).find((s) => s.uses?.startsWith("actions/upload-artifact@"));
  if (!upload) out.push("dry-run job has no upload-artifact step");
  else {
    if (upload.with?.path !== "release/*.AppImage") out.push("upload path is not release/*.AppImage");
    if (upload.with?.["retention-days"] !== 7) out.push("upload retention is not 7 days");
  }
  const publish = (job.steps ?? []).some((s) => /action-gh-release|gh release|--publish|-p always/.test(`${s.uses ?? ""} ${s.run ?? ""}`));
  if (publish) out.push("dry-run job has a publish step");
  return out;
}

const ci = load(".github/workflows/ci.yml");
const release = load(".github/workflows/release.yml");

describe("ci.yml release-dryrun job", () => {
  it("builds with the same commands as release.yml build-linux, keeps the AppImage 7 days and holds no write permission", () => {
    expect(problems(ci, release)).toEqual([]);
  });

  it("runs npm ci, npm run build and electron-builder --linux -p never, in that order", () => {
    expect(buildCommands(ci.jobs?.["release-dryrun"])).toEqual(["npm ci", "npm run build", "npx electron-builder --linux -p never"]);
  });

  it("fails when release.yml's package command differs", () => {
    const changed = structuredClone(release);
    for (const s of changed.jobs?.["build-linux"]?.steps ?? []) {
      if (s.run) s.run = s.run.replace("--linux -p never", "--linux --x64 -p never");
    }
    expect(problems(ci, changed)).toContain(WRONG_COMMANDS);
  });

  it("fails when the job gains a write permission, loses its retention or publishes", () => {
    const write = structuredClone(ci);
    write.jobs!["release-dryrun"].permissions = { contents: "write" };
    expect(problems(write, release)).toContain("dry-run job holds a write permission");
    const topLevel = structuredClone(ci);
    topLevel.permissions = "write-all";
    expect(problems(topLevel, release)).toContain("dry-run job holds a write permission");
    const retention = structuredClone(ci);
    for (const s of retention.jobs!["release-dryrun"].steps!) if (s.with?.["retention-days"]) s.with["retention-days"] = 90;
    expect(problems(retention, release)).toContain("upload retention is not 7 days");
    const publish = structuredClone(ci);
    publish.jobs!["release-dryrun"].steps!.push({ uses: "softprops/action-gh-release@abc" });
    expect(problems(publish, release)).toContain("dry-run job has a publish step");
  });
});
