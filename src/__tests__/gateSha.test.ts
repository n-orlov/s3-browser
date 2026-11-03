import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const SCRIPT = path.resolve(__dirname, "../../ci/gate-sha.sh");

// Three repositories, the way a pull request build sees them: `origin` (bare, stands in for GitHub, with the PR head
// published as refs/pull/<id>/head), `dev` (where the PR branch and master are written and pushed) and `ws` (the
// Jenkins workspace, which only fetches and checks out).
let root: string;
let origin: string;
let dev: string;
let ws: string;

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_MERGE_AUTOEDIT: "no",
};

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...GIT_ENV } }).trim();
}
const git = (...args: string[]): string => gitIn(dev, ...args);

let counter = 0;
function commit(msg: string): string {
  writeFileSync(path.join(dev, `f${counter++}.txt`), msg);
  git("add", "-A");
  git("commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
}

/** Publishes the dev repo's master and the PR head the way GitHub holds them. */
function publish(id: string, prHead: string): void {
  git("push", "-q", "-f", "origin", "master:refs/heads/master", `${prHead}:refs/pull/${id}/head`);
}

/**
 * Jenkins' checkout of a pull request build, as its console logs it: fetch the PR ref and the target, `git checkout -f`
 * the PR head pinned when the build was scheduled, then (merge strategy) `git merge` the pinned target sha. The pins
 * can be older than what the fetch brought in.
 */
function jenkinsCheckout(id: string, pinnedHead: string, pinnedTarget?: string): void {
  gitIn(ws, "fetch", "-q", "--no-tags", "--force", "origin", `+refs/pull/${id}/head:refs/remotes/origin/PR-${id}`, "+refs/heads/master:refs/remotes/origin/master");
  gitIn(ws, "checkout", "-q", "-f", pinnedHead);
  if (pinnedTarget) gitIn(ws, "merge", "-q", pinnedTarget);
}

function gateSha(env: Record<string, string>): string {
  return execFileSync("sh", [SCRIPT], {
    cwd: ws,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH ?? "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", ...env },
  }).trim();
}
const prGate = (id: string): string => gateSha({ CHANGE_ID: id, CHANGE_TARGET: "master", BRANCH_NAME: `PR-${id}` });
const wsHead = (rev = "HEAD"): string => gitIn(ws, "rev-parse", rev);

/** A PR branch whose head is a merge commit: the branch merged master and pushed that merge. */
function mergeCommitHead(): string {
  git("checkout", "-q", "-b", "pr");
  commit("pr work");
  git("checkout", "-q", "master");
  commit("master moved");
  git("checkout", "-q", "pr");
  git("merge", "--no-ff", "-q", "-m", "Merge branch 'master' into pr", "master");
  return git("rev-parse", "HEAD");
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "gate-sha-"));
  origin = path.join(root, "origin.git");
  dev = path.join(root, "dev");
  ws = path.join(root, "ws");
  mkdirSync(dev);
  mkdirSync(ws);
  gitIn(root, "init", "-q", "--bare", "-b", "master", origin);
  git("init", "-q", "-b", "master");
  git("remote", "add", "origin", origin);
  commit("base");
  git("push", "-q", "origin", "master");
  gitIn(ws, "init", "-q", "-b", "scratch");
  gitIn(ws, "remote", "add", "origin", origin);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("ci/gate-sha.sh: the gate status targets the PR head Jenkins selected for the build", () => {
  it("is the PR head itself when the checkout is a simple commit (target merge a no-op)", () => {
    const base = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "pr");
    const head = commit("pr work");
    publish("7", head);
    jenkinsCheckout("7", head, base);
    expect(wsHead()).toBe(head);
    expect(prGate("7")).toBe(head);
  });

  it("is the first parent of the synthetic merge Jenkins made with a moved target", () => {
    git("checkout", "-q", "-b", "pr");
    const head = commit("pr work");
    git("checkout", "-q", "master");
    const tip = commit("master moved");
    publish("8", head);
    jenkinsCheckout("8", head, tip);
    expect(wsHead("HEAD^1")).toBe(head);
    expect(wsHead("HEAD^2")).toBe(tip);
    expect(prGate("8")).toBe(head);
  });

  it("is the merge commit itself when the PR head is a merge commit and the target merge is a no-op", () => {
    const head = mergeCommitHead();
    publish("9", head);
    jenkinsCheckout("9", head, git("rev-parse", "master"));
    expect(wsHead()).toBe(head);
    // The regression: replacing the merge-commit head by its first parent would post on the PR's previous commit.
    expect(prGate("9")).not.toBe(wsHead("HEAD^1"));
    expect(prGate("9")).toBe(head);
  });

  it("is the merge-commit PR head when Jenkins put a synthetic merge on top of it", () => {
    const head = mergeCommitHead();
    git("checkout", "-q", "master");
    const tip = commit("master moved again");
    publish("10", head);
    jenkinsCheckout("10", head, tip);
    expect(wsHead("HEAD^1")).toBe(head);
    expect(prGate("10")).toBe(head);
  });

  it("is the pinned head, not the newer fetched ref, when the PR moved before the checkout (direct checkout)", () => {
    const base = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "pr");
    const pinned = commit("pr work");
    const newer = commit("pushed after the build was scheduled");
    publish("73", newer);
    jenkinsCheckout("73", pinned, base);
    expect(wsHead("refs/remotes/origin/PR-73")).toBe(newer);
    expect(prGate("73")).toBe(pinned);
  });

  it("is the pinned head, not the newer fetched ref, when the PR moved and Jenkins made a synthetic merge", () => {
    git("checkout", "-q", "-b", "pr");
    const pinned = commit("pr work");
    const newer = commit("pushed after the build was scheduled");
    git("checkout", "-q", "master");
    const tip = commit("master moved");
    publish("73", newer);
    jenkinsCheckout("73", pinned, tip);
    expect(wsHead("refs/remotes/origin/PR-73")).toBe(newer);
    expect(wsHead("HEAD^1")).toBe(pinned);
    expect(prGate("73")).toBe(pinned);
  });

  it("keeps a pinned merge-commit head after the PR moved on, with and without a synthetic merge", () => {
    const pinned = mergeCommitHead();
    const newer = commit("pushed after the build was scheduled");
    git("checkout", "-q", "master");
    const tip = commit("master moved again");
    publish("74", newer);

    jenkinsCheckout("74", pinned, git("rev-parse", "master~1"));
    expect(wsHead()).toBe(pinned);
    expect(prGate("74")).toBe(pinned);

    jenkinsCheckout("74", pinned, tip);
    expect(wsHead("HEAD^1")).toBe(pinned);
    expect(prGate("74")).toBe(pinned);
  });

  it("is the pinned head when the target also moved after the synthetic merge was pinned", () => {
    git("checkout", "-q", "-b", "pr");
    const head = commit("pr work");
    git("checkout", "-q", "master");
    const pinnedTip = commit("master moved");
    commit("master moved after scheduling");
    publish("75", head);
    jenkinsCheckout("75", head, pinnedTip);
    expect(wsHead("refs/remotes/origin/master")).not.toBe(pinnedTip);
    expect(prGate("75")).toBe(head);
  });

  it("treats a detached-HEAD merge of the target by name as the synthetic merge too", () => {
    git("checkout", "-q", "-b", "pr");
    const head = commit("pr work");
    git("checkout", "-q", "master");
    commit("master moved");
    publish("76", head);
    jenkinsCheckout("76", head);
    gitIn(ws, "merge", "-q", "origin/master");
    expect(gitIn(ws, "log", "-1", "--format=%s")).toBe("Merge remote-tracking branch 'origin/master' into HEAD");
    expect(prGate("76")).toBe(head);
  });

  it("keeps a merge-commit head that no remote ref contains when git did not make it on a detached HEAD", () => {
    const head = mergeCommitHead();
    publish("77", head);
    jenkinsCheckout("77", head);
    // The PR was force-pushed away; the workspace still holds the pinned merge commit from its earlier fetch.
    git("checkout", "-q", "master");
    publish("77", commit("unrelated force-push"));
    gitIn(ws, "fetch", "-q", "--force", "origin", "+refs/pull/77/head:refs/remotes/origin/PR-77", "+refs/heads/master:refs/remotes/origin/master");
    expect(gitIn(ws, "for-each-ref", "--contains", "HEAD", "refs/remotes")).toBe("");
    expect(prGate("77")).toBe(head);
  });

  it("is HEAD for a branch build, even when HEAD is a merge commit", () => {
    git("checkout", "-q", "-b", "side");
    commit("side work");
    git("checkout", "-q", "master");
    commit("master work");
    git("merge", "--no-ff", "-q", "-m", "Merge side", "side");
    const head = git("rev-parse", "HEAD");
    git("push", "-q", "origin", "master");
    gitIn(ws, "fetch", "-q", "origin", "+refs/heads/master:refs/remotes/origin/master");
    gitIn(ws, "checkout", "-q", "-f", head);
    expect(gateSha({ BRANCH_NAME: "master" })).toBe(head);
  });
});
