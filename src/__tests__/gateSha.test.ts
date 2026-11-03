import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const SCRIPT = path.resolve(__dirname, "../../ci/gate-sha.sh");

let dir: string;

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  }).trim();
}

let counter = 0;
function commit(msg: string): string {
  writeFileSync(path.join(dir, `f${counter++}.txt`), msg);
  git("add", "-A");
  git("commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
}

function gateSha(env: Record<string, string>): { out: string; status: number } {
  try {
    const out = execFileSync("sh", [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", ...env },
    }).trim();
    return { out, status: 0 };
  } catch (e) {
    return { out: "", status: (e as { status: number }).status };
  }
}

/** Records the sha as the PR head ref and the target tip the way Jenkins' checkout leaves them. */
function fetched(pr: string, prHead: string, targetTip: string): void {
  git("update-ref", `refs/remotes/origin/PR-${pr}`, prHead);
  git("update-ref", "refs/remotes/origin/master", targetTip);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gate-sha-"));
  git("init", "-q", "-b", "master");
  commit("base");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ci/gate-sha.sh: the gate status targets the head Jenkins selected for the build", () => {
  it("is the PR head itself when the checkout is a simple commit", () => {
    const base = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "pr");
    const head = commit("pr work");
    fetched("7", head, base);
    expect(gateSha({ CHANGE_ID: "7", CHANGE_TARGET: "master" })).toEqual({ out: head, status: 0 });
  });

  it("is the first parent when Jenkins added a synthetic merge of the moved target", () => {
    const base = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "pr");
    const head = commit("pr work");
    git("checkout", "-q", "master");
    const tip = commit("master moved");
    git("checkout", "-q", "--detach", head);
    git("merge", "--no-ff", "-q", "-m", "Merge commit tip", tip);
    expect(git("rev-parse", "HEAD^2")).toBe(tip);
    fetched("8", head, tip);
    expect(base).not.toBe(tip);
    expect(gateSha({ CHANGE_ID: "8", CHANGE_TARGET: "master" })).toEqual({ out: head, status: 0 });
  });

  it("is the merge commit itself when the PR head is a merge commit and there is no synthetic merge", () => {
    git("checkout", "-q", "-b", "pr");
    commit("pr work");
    git("checkout", "-q", "master");
    const tip = commit("master moved");
    git("checkout", "-q", "pr");
    git("merge", "--no-ff", "-q", "-m", "Merge master into pr", "master");
    const head = git("rev-parse", "HEAD");
    expect(git("rev-parse", "HEAD^1")).not.toBe(head);
    fetched("9", head, tip);
    expect(gateSha({ CHANGE_ID: "9", CHANGE_TARGET: "master" })).toEqual({ out: head, status: 0 });
  });

  it("is the first parent when a merge-commit PR head also got a synthetic merge", () => {
    git("checkout", "-q", "-b", "pr");
    commit("pr work");
    git("checkout", "-q", "master");
    const old = commit("master moved");
    git("checkout", "-q", "pr");
    git("merge", "--no-ff", "-q", "-m", "Merge master into pr", "master");
    const head = git("rev-parse", "HEAD");
    git("checkout", "-q", "master");
    const tip = commit("master moved again");
    git("checkout", "-q", "--detach", head);
    git("merge", "--no-ff", "-q", "-m", "Merge commit tip", tip);
    fetched("10", head, tip);
    expect(old).not.toBe(tip);
    expect(gateSha({ CHANGE_ID: "10", CHANGE_TARGET: "master" })).toEqual({ out: head, status: 0 });
  });

  it("keeps a merge-commit PR head whose second parent is the unchanged target tip (a no-op synthetic merge)", () => {
    git("checkout", "-q", "-b", "pr");
    commit("pr work");
    git("checkout", "-q", "master");
    const tip = commit("master moved");
    git("checkout", "-q", "pr");
    git("merge", "--no-ff", "-q", "-m", "Merge master into pr", "master");
    const head = git("rev-parse", "HEAD");
    expect(git("rev-parse", "HEAD^2")).toBe(tip);
    fetched("11", head, tip);
    expect(gateSha({ CHANGE_ID: "11", CHANGE_TARGET: "master" }).out).toBe(head);
  });

  it("is HEAD for a branch build, even when HEAD is a merge commit", () => {
    git("checkout", "-q", "-b", "side");
    commit("side work");
    git("checkout", "-q", "master");
    commit("master work");
    git("merge", "--no-ff", "-q", "-m", "Merge side", "side");
    const head = git("rev-parse", "HEAD");
    expect(gateSha({ BRANCH_NAME: "master" })).toEqual({ out: head, status: 0 });
  });

  it("fails rather than posting on a commit that is not the PR head or a merge on top of it", () => {
    const base = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "pr");
    const head = commit("pr work");
    git("checkout", "-q", "master");
    const other = commit("unrelated");
    fetched("12", head, base);
    expect(other).not.toBe(head);
    expect(gateSha({ CHANGE_ID: "12", CHANGE_TARGET: "master" }).status).not.toBe(0);
  });

  it("without the PR head ref, a merge on the target tip is a synthetic merge and a merge elsewhere is the head", () => {
    git("checkout", "-q", "-b", "pr");
    const head = commit("pr work");
    git("checkout", "-q", "master");
    const tip = commit("master moved");
    git("checkout", "-q", "--detach", head);
    git("merge", "--no-ff", "-q", "-m", "Merge commit tip", tip);
    git("update-ref", "refs/remotes/origin/master", tip);
    expect(gateSha({ CHANGE_ID: "13", CHANGE_TARGET: "master" }).out).toBe(head);

    git("update-ref", "refs/remotes/origin/master", head);
    const merged = git("rev-parse", "HEAD");
    expect(gateSha({ CHANGE_ID: "13", CHANGE_TARGET: "master" }).out).toBe(merged);
  });
});
