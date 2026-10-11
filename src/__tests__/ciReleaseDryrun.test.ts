import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { parse } from "yaml";

type Step = { id?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { "runs-on"?: unknown; permissions?: unknown; needs?: string | string[]; if?: string; steps?: Step[] };
type Workflow = { on?: Record<string, unknown>; permissions?: unknown; jobs?: Record<string, Job> };

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

  it("runs the AppImage smoke script after the electron-builder step", () => {
    const steps = ci.jobs?.["release-dryrun"]?.steps ?? [];
    const build = steps.findIndex((s) => /npx electron-builder\b/.test(s.run ?? ""));
    const smoke = steps.findIndex((s) => /scripts\/smoke-appimage\.sh\b/.test(s.run ?? ""));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(smoke).toBeGreaterThan(build);
  });

  it("has a smoke script that extracts the AppImage and launches it under xvfb in the Playwright image", () => {
    const script = readFileSync(path.join(root, "scripts/smoke-appimage.sh"), "utf8");
    expect(script).toContain("--appimage-extract");
    expect(script).toContain("xvfb-run");
    expect(script).toContain("mcr.microsoft.com/playwright:v");
    expect(script).toContain("--no-sandbox");
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

const RELEASE_PATHS = ["package.json", "build/**", "electron-builder*", ".github/workflows/release.yml", "vite.config.*", "tsconfig*.json"];

const filterStep = ci.jobs?.changes?.steps?.find((s) => s.id === "filter");

/** Runs the `changes` filter step in a throwaway git repo whose second commit touches `changed`; returns its `release` output. */
function releaseOutput(event: string, changed: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "changes-"));
  try {
    const git = (...args: string[]) => {
      const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    git("init", "-q");
    writeFileSync(path.join(dir, "README.md"), "base");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    for (const file of changed) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), "x");
    }
    writeFileSync(path.join(dir, "README.md"), "head");
    git("add", "-A");
    git("commit", "-q", "-m", "head");
    const head = git("rev-parse", "HEAD");
    const output = path.join(dir, "..", `${path.basename(dir)}.out`);
    writeFileSync(output, "");
    const env: Record<string, string> = { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: output };
    for (const [name, value] of Object.entries(filterStep?.env ?? {})) {
      env[name] = value
        .replace(/\$\{\{\s*github\.event_name\s*\}\}/, event)
        .replace(/\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/, base)
        .replace(/\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/, head);
    }
    const r = spawnSync("bash", ["-e", "-c", filterStep?.run ?? "exit 99"], { cwd: dir, env, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(output, "utf8");
    rmSync(output);
    return out.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the gate step's script with the given results of the four needs; returns the exit code. */
function gateExit(releaseDryrun: string): number {
  const step = ci.jobs?.gate?.steps?.find((s) => s.run);
  const results: Record<string, string> = { quality: "success", e2e: "success", changes: "success", "release-dryrun": releaseDryrun };
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(step?.env ?? {})) {
    env[name] = value.replace(/\$\{\{\s*needs\.([\w-]+)\.result\s*\}\}/, (_, need: string) => results[need] ?? "");
  }
  return spawnSync("bash", ["-e", "-c", step?.run ?? "exit 99"], { env: { PATH: process.env.PATH ?? "", ...env } }).status ?? -1;
}

describe("ci.yml release-dryrun triggers and gate interaction", () => {
  it("has a weekly schedule trigger", () => {
    const schedule = ci.on?.schedule as { cron: string }[] | undefined;
    expect(schedule).toHaveLength(1);
    const fields = schedule![0].cron.split(/\s+/);
    expect(fields).toHaveLength(5);
    expect(fields.slice(2, 4)).toEqual(["*", "*"]);
    expect(fields[4]).toMatch(/^[0-6]$/);
    expect(ci.on).toHaveProperty("workflow_dispatch");
    expect(ci.on).toHaveProperty("push");
  });

  it("runs release-dryrun only through the changes job, whose path list is exactly the six packaging patterns", () => {
    expect(ci.jobs?.["release-dryrun"]?.needs).toBe("changes");
    expect(ci.jobs?.["release-dryrun"]?.if).toContain("needs.changes.outputs.release == 'true'");
    const list = (filterStep?.env?.RELEASE_PATHS ?? "").split("\n").filter((l) => l.trim() !== "");
    expect(list).toEqual(RELEASE_PATHS);
  });

  it("builds on push, schedule and manual runs without looking at changed files", () => {
    for (const event of ["push", "schedule", "workflow_dispatch"]) expect(releaseOutput(event, ["README.md"]), event).toBe("release=true");
  });

  it("builds a pull request only when it changes one of the six path patterns", () => {
    const hits = ["package.json", "build/vite.config.ts", "build/deep/er/file.txt", "electron-builder.yml", ".github/workflows/release.yml", "vite.config.ts", "tsconfig.json", "tsconfig.main.json"];
    for (const file of hits) expect(releaseOutput("pull_request", [file]), file).toBe("release=true");
    const misses = ["src/main/index.ts", ".github/workflows/ci.yml", "docs/package.json.md", "src/vite.config.ts", "tsconfig.txt", "e2e/build.e2e.ts"];
    for (const file of misses) expect(releaseOutput("pull_request", [file]), file).toBe("release=false");
    expect(releaseOutput("pull_request", ["src/a.ts", "tsconfig.preload.json"])).toBe("release=true");
  });

  it("makes gate need release-dryrun: skipped and success pass, failure and cancelled fail", () => {
    expect(ci.jobs?.gate?.needs).toContain("release-dryrun");
    expect(gateExit("skipped")).toBe(0);
    expect(gateExit("success")).toBe(0);
    expect(gateExit("failure")).toBe(1);
    expect(gateExit("cancelled")).toBe(1);
  });
});
