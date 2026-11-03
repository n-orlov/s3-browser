import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { readFileSync } from "fs";
import path from "path";

const SCRIPT = path.resolve(__dirname, "../../ci/gate-sha.sh");

/** The shell the Jenkinsfile runs before every gated checkout (beginCheckout), extracted so the tests run the real one. */
const BEGIN_CHECKOUT = (() => {
  const jenkinsfile = readFileSync(path.resolve(__dirname, "../../Jenkinsfile"), "utf8");
  const m = /^def beginCheckout\(\) \{\n {2}sh '''\n([\s\S]*?)\n {2}'''\n {2}checkout scm\n\}/m.exec(jenkinsfile);
  if (!m) throw new Error("Jenkinsfile has no beginCheckout helper of the expected shape");
  return m[1];
})();

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
 * the PR head pinned when the build was scheduled, then (merge strategy) `git merge` the pinned target sha, then
 * `git checkout -f` the result. The pins can be older than what the fetch brought in.
 */
function jenkinsCheckout(id: string, pinnedHead: string, pinnedTarget?: string): void {
  beginCheckout();
  gitIn(ws, "fetch", "-q", "--no-tags", "--force", "origin", `+refs/pull/${id}/head:refs/remotes/origin/PR-${id}`, "+refs/heads/master:refs/remotes/origin/master");
  gitIn(ws, "checkout", "-q", "-f", pinnedHead);
  if (pinnedTarget) gitIn(ws, "merge", "-q", pinnedTarget);
  gitIn(ws, "checkout", "-q", "-f", gitIn(ws, "rev-parse", "HEAD"));
}

/** What the Jenkinsfile does before `checkout scm`: forget earlier builds' history and record where HEAD stands. */
function beginCheckout(): void {
  execFileSync("sh", ["-c", BEGIN_CHECKOUT], { cwd: ws, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", ...GIT_ENV } });
}

/** Makes a commit that exists only in the workspace (a build's synthetic merge) a published PR head. */
function publishWorkspaceCommit(id: string, sha: string): void {
  gitIn(ws, "update-ref", "refs/heads/imported", sha);
  git("fetch", "-q", ws, "+refs/heads/imported:refs/heads/imported");
  publish(id, sha);
}

/** Brings a published PR head into the workspace the way an earlier build's fetch did. */
function earlierFetch(id: string): void {
  gitIn(ws, "fetch", "-q", "--no-tags", "--force", "origin", `+refs/pull/${id}/head:refs/remotes/origin/PR-${id}`, "+refs/heads/master:refs/remotes/origin/master");
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

/**
 * A PR head that is a merge commit made on a detached HEAD (`git checkout --detach pr; git merge master`), so its subject
 * is git's "Merge branch 'master' into HEAD", the same shape as the merge Jenkins makes.
 */
function detachedMergeHead(): string {
  git("checkout", "-q", "-b", "pr");
  commit("pr work");
  git("checkout", "-q", "master");
  commit("master moved");
  git("checkout", "-q", "--detach", "pr");
  git("merge", "--no-ff", "-q", "master");
  const head = git("rev-parse", "HEAD");
  git("checkout", "-q", "master");
  return head;
}

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

  it("is the detached-HEAD merge PR head, not its first parent, when it was force-pushed away before the checkout fetch", () => {
    const head = detachedMergeHead();
    publish("91", head);
    earlierFetch("91");
    publish("91", commit("force-pushed over the selected head"));
    jenkinsCheckout("91", head, git("rev-parse", "master~1"));
    expect(wsHead()).toBe(head);
    expect(gitIn(ws, "log", "-1", "--format=%s")).toBe("Merge branch 'master' into HEAD");
    expect(gitIn(ws, "for-each-ref", "--contains", "HEAD", "refs/remotes")).toBe("");
    // The regression: an actual PR merge head replaced by its first parent.
    expect(prGate("91")).not.toBe(wsHead("HEAD^1"));
    expect(prGate("91")).toBe(head);
  });

  it("is the detached-HEAD merge PR head when Jenkins put a synthetic merge on top of it", () => {
    const head = detachedMergeHead();
    const tip = commit("master moved after the PR merge");
    publish("92", head);
    jenkinsCheckout("92", head, tip);
    expect(wsHead("HEAD^1")).toBe(head);
    expect(wsHead("HEAD^2")).toBe(tip);
    expect(prGate("92")).toBe(head);
  });

  it("is a PR merge head whose subject is exactly Jenkins' merge subject, still published, when the target merge is a no-op", () => {
    git("checkout", "-q", "-b", "pr");
    commit("pr work");
    git("checkout", "-q", "master");
    const tip = commit("master moved");
    git("checkout", "-q", "--detach", "pr");
    git("merge", "--no-ff", "-q", tip);
    const head = git("rev-parse", "HEAD");
    git("checkout", "-q", "master");
    publish("93", head);
    jenkinsCheckout("93", head, tip);
    expect(gitIn(ws, "log", "-1", "--format=%s")).toBe(`Merge commit '${tip}' into HEAD`);
    expect(prGate("93")).toBe(head);
  });

  it("is the pinned head, not the target tip, when the target merge fast-forwarded over it", () => {
    git("checkout", "-q", "-b", "pr");
    const head = commit("pr work");
    git("checkout", "-q", "master");
    git("merge", "--ff-only", "-q", "pr");
    const tip = commit("master moved past the PR head");
    publish("94", head);
    jenkinsCheckout("94", head, tip);
    expect(wsHead()).toBe(tip);
    expect(prGate("94")).toBe(head);
  });

  it("ignores an earlier build's synthetic merge in a reused workspace when this build's target merge is a no-op", () => {
    git("checkout", "-q", "-b", "earlier-pr");
    const first = commit("earlier pr work");
    git("checkout", "-q", "master");
    const tip = commit("master moved");
    publish("95", first);
    jenkinsCheckout("95", first, tip);
    expect(prGate("95")).toBe(first);
    const head = detachedMergeHead();
    publish("95", head);
    jenkinsCheckout("95", head, git("rev-parse", "master"));
    expect(wsHead()).toBe(head);
    expect(prGate("95")).toBe(head);
  });

  it("fails rather than guess when the checkout did not start with beginCheckout", () => {
    const head = detachedMergeHead();
    publish("96", head);
    gitIn(ws, "fetch", "-q", "--no-tags", "--force", "origin", "+refs/pull/96/head:refs/remotes/origin/PR-96");
    gitIn(ws, "checkout", "-q", "-f", head);
    expect(() => prGate("96")).toThrow(/no checkout boundary/);
  });

  it("fails rather than guess when the reflog is gone although the checkout moved HEAD", () => {
    const head = detachedMergeHead();
    publish("97", head);
    jenkinsCheckout("97", head, git("rev-parse", "master"));
    rmSync(path.join(ws, ".git", "logs", "HEAD"));
    gitIn(ws, "checkout", "-q", "-f", "--detach", "refs/remotes/origin/master");
    rmSync(path.join(ws, ".git", "logs", "HEAD"));
    expect(() => prGate("97")).toThrow(/without a reflog record/);
  });

  it("fails rather than guess when the reflog does not start at the recorded boundary", () => {
    const head = detachedMergeHead();
    publish("98", head);
    jenkinsCheckout("98", head, git("rev-parse", "master"));
    expect(prGate("98")).toBe(head);
    // A log that holds entries from before the boundary (or a boundary of another checkout) is not this build's.
    writeFileSync(path.join(ws, ".git", "gate-sha-boundary"), `${"1".repeat(40)}\n`);
    expect(() => prGate("98")).toThrow(/does not start at the boundary/);
  });

  describe("selects per build, independently of what earlier builds left in the workspace", () => {
    it("is the selected merge head itself when it equals the previous build's synthetic merge and the target merge is a no-op", () => {
      git("checkout", "-q", "-b", "pr");
      const first = commit("pr work");
      git("checkout", "-q", "master");
      const tip = commit("master moved");
      publish("200", first);
      jenkinsCheckout("200", first, tip);
      const synthetic = wsHead();
      expect(wsHead("HEAD^1")).toBe(first);
      expect(prGate("200")).toBe(first);
      // The synthetic merge is pushed to the PR; the next build selects it and merging the target changes nothing.
      publishWorkspaceCommit("200", synthetic);
      jenkinsCheckout("200", synthetic, tip);
      expect(wsHead()).toBe(synthetic);
      expect(prGate("200")).toBe(synthetic);
      expect(prGate("200")).not.toBe(first);
    });

    it("is the new selected head when it equals the target tip an earlier build fast-forwarded to", () => {
      git("checkout", "-q", "-b", "pr");
      const first = commit("pr work");
      git("checkout", "-q", "master");
      git("merge", "--ff-only", "-q", "pr");
      const tip = commit("master moved past the PR head");
      publish("201", first);
      jenkinsCheckout("201", first, tip);
      expect(wsHead()).toBe(tip);
      expect(prGate("201")).toBe(first);
      // The PR branch is then fast-forwarded to the target tip: the selected head is the tip, not the old head.
      publish("201", tip);
      jenkinsCheckout("201", tip, tip);
      expect(wsHead()).toBe(tip);
      expect(prGate("201")).toBe(tip);
    });

    it("is still the original head when that unchanged head is rebuilt against the target", () => {
      git("checkout", "-q", "-b", "pr");
      const head = commit("pr work");
      git("checkout", "-q", "master");
      const tip = commit("master moved");
      publish("202", head);
      jenkinsCheckout("202", head, tip);
      expect(prGate("202")).toBe(head);
      jenkinsCheckout("202", head, tip);
      expect(wsHead("HEAD^1")).toBe(head);
      expect(prGate("202")).toBe(head);
    });

    it("is the selected head over many rebuilds of the same pinned head, whatever each left behind", () => {
      git("checkout", "-q", "-b", "pr");
      const head = commit("pr work");
      git("checkout", "-q", "master");
      const tip = commit("master moved");
      publish("203", head);
      for (let build = 0; build < 3; build++) {
        jenkinsCheckout("203", head, tip);
        expect(prGate("203")).toBe(head);
      }
    });

    it("is the merge-commit head when an earlier build of another PR head left a merge ending at the same commit", () => {
      const head = mergeCommitHead();
      git("checkout", "-q", "master");
      const tip = commit("master moved again");
      publish("204", head);
      jenkinsCheckout("204", head, tip);
      const synthetic = wsHead();
      expect(prGate("204")).toBe(head);
      // A different PR in the same workspace selects that very merge as its head.
      publishWorkspaceCommit("205", synthetic);
      jenkinsCheckout("205", synthetic, tip);
      expect(prGate("205")).toBe(synthetic);
    });

    it("is the selected head when an earlier build ended at it through a detached-HEAD merge of the target by name", () => {
      git("checkout", "-q", "-b", "pr");
      const head = commit("pr work");
      git("checkout", "-q", "master");
      commit("master moved");
      publish("206", head);
      jenkinsCheckout("206", head);
      gitIn(ws, "merge", "-q", "origin/master");
      const merged = wsHead();
      publishWorkspaceCommit("206", merged);
      jenkinsCheckout("206", merged, git("rev-parse", "master"));
      expect(prGate("206")).toBe(merged);
    });

    it("is the selected head when it equals the previous build's result and the workspace was left on a branch", () => {
      git("checkout", "-q", "-b", "pr");
      const head = commit("pr work");
      publish("207", head);
      jenkinsCheckout("207", head, git("rev-parse", "master"));
      gitIn(ws, "checkout", "-q", "-f", "-B", "left-on-branch", head);
      jenkinsCheckout("207", head, git("rev-parse", "master"));
      expect(prGate("207")).toBe(head);
    });
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
