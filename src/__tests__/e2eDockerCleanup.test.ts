import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const root = path.resolve(__dirname, "../..");
const script = path.join(root, "scripts/e2e-docker.sh");

/** A `docker` stand-in that logs every call; the foreground-style `run --rm` container "runs" until killed. */
const STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
if [[ "$1" == "run" && "$2" == "--rm" || "$1" == "run" && "$*" == *" --rm "* ]]; then
  echo started >> "$STUB_LOG.started"
  if [[ -n "\${STUB_HANG:-}" ]]; then exec sleep 60; fi
  exit "\${STUB_EXIT:-0}"
fi
exit 0
`;

let dir: string;
let log: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "e2e-docker-stub-"));
  log = path.join(dir, "docker.log");
  writeFileSync(path.join(dir, "docker"), STUB);
  chmodSync(path.join(dir, "docker"), 0o755);
  writeFileSync(log, "");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function start(env: Record<string, string>) {
  const child = spawn("bash", [script, "e2e/app-launch.e2e.ts"], {
    cwd: root,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STUB_LOG: log, S3B_NPM_CACHE: path.join(dir, "npm"), ...env },
    stdio: "ignore",
  });
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, exited };
}

const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);

async function waitForPlaywrightRun(): Promise<void> {
  const marker = `${log}.started`;
  for (let i = 0; i < 200 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 25));
  expect(existsSync(marker)).toBe(true);
}

describe("scripts/e2e-docker.sh cleanup", () => {
  it("removes the LocalStack container with rm -fv and its network on a normal exit", async () => {
    const { exited } = start({ BUILD_TAG: "jenkins-s3-browser-ci-PR-30-7" });
    expect(await exited).toBe(0);
    const c = calls();
    const lsRun = c.find((l) => l.startsWith("run -d --name "))!;
    const ls = lsRun.split(" ")[3];
    expect(ls).toMatch(/^s3b-localstack-jenkins-s3-browser-ci-PR-30-7-shard0-\d+$/);
    expect(c).toContain(`rm -fv ${ls}`);
    expect(c.some((l) => /^network rm s3b-e2e-jenkins-s3-browser-ci-PR-30-7-shard0-\d+$/.test(l))).toBe(true);
  });

  it("still removes the LocalStack container after SIGTERM while the Playwright container runs", async () => {
    const { child, exited } = start({ STUB_HANG: "1" });
    await waitForPlaywrightRun();
    child.kill("SIGTERM");
    expect(await exited).toBe(143);
    const c = calls();
    const ls = c.find((l) => l.startsWith("run -d --name "))!.split(" ")[3];
    expect(c).toContain(`rm -fv ${ls}`);
    expect(c.some((l) => l.startsWith("network rm s3b-e2e-"))).toBe(true);
  });

  it("removes the LocalStack container after SIGINT and keeps a failing exit status", async () => {
    const { child, exited } = start({ STUB_HANG: "1" });
    await waitForPlaywrightRun();
    child.kill("SIGINT");
    expect(await exited).toBe(130);
    const ls = calls().find((l) => l.startsWith("run -d --name "))!.split(" ")[3];
    expect(calls()).toContain(`rm -fv ${ls}`);

    const failing = start({ STUB_EXIT: "3" });
    expect(await failing.exited).toBe(3);
  });

  it("caps the memory of both docker run containers", async () => {
    const { exited } = start({});
    await exited;
    const runs = calls().filter((l) => l.startsWith("run "));
    expect(runs).toHaveLength(2);
    for (const r of runs) expect(r).toMatch(/--memory \d+[mg]\b/);
  });

  it("falls back to GITHUB_RUN_ID when BUILD_TAG is unset", async () => {
    const { exited } = start({ BUILD_TAG: "", GITHUB_RUN_ID: "991", GITHUB_RUN_ATTEMPT: "2" });
    await exited;
    expect(calls().some((l) => /^network create s3b-e2e-991-2-shard0-\d+$/.test(l))).toBe(true);
  });
});
