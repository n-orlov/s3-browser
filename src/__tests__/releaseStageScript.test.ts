import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const REAL = readFileSync(path.resolve(__dirname, "../../ci/release-stage.sh"), "utf8");
const API = "https://api.github.com/repos/o/r";
const SHA = "a".repeat(40);

/** A GitHub client on PATH: records every call and answers like the REST API from STUB_* variables. */
const STUB_CURL = `#!/usr/bin/env bash
method=GET; url=; ver=none
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method=$2; shift ;;
    -H) case "$2" in X-GitHub-Api-Version:*) ver=\${2#*: } ;; esac; shift ;;
    -d) printf '%s' "$2" > "$STUB_DIR/last-body.json"; body=$2; shift ;;
    --data-binary|-o|-w) shift ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
printf '%s %s version=%s\\n' "$method" "$url" "$ver" >> "$STUB_DIR/calls.log"
case "$method $url" in
  "GET $STUB_API_ROOT/git/matching-refs/tags/"*)
    if [ "\${STUB_TAG_EXISTS:-0}" = 1 ]; then echo '[{"ref":"refs/tags/v0.20.0"}]'; else echo '[]'; fi ;;
  "GET $STUB_API_ROOT/releases?per_page=100") echo '[]' ;;
  "GET $STUB_API_ROOT/immutable-releases") echo "{\\"enabled\\": \${STUB_IMMUTABLE:-true}}" ;;
  "POST $STUB_API_ROOT/releases") printf '%s' "$body" > "$STUB_DIR/create-body.json"; echo '{"id": 4242}' ;;
  "POST $STUB_API_ROOT/actions/workflows/macos-build.yml/dispatches")
    printf '%s' "$body" > "$STUB_DIR/dispatch-body.json"
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["inputs"]["correlation_id"])' "$STUB_DIR/dispatch-body.json" > "$STUB_DIR/corr"
    echo '{"workflow_run_id": 777}' ;;
  "GET $STUB_API_ROOT/releases/4242")
    v=\${STUB_VERSION:-0.20.0}
    names="S3.Browser-$v.AppImage S3.Browser.Setup.$v.exe S3.Browser.$v.exe S3.Browser-$v.dmg S3.Browser-$v-arm64.dmg sbom.cdx.json"
    out=; sep=
    for n in $names; do
      [ "$n" = "\${STUB_OMIT:-}" ] && continue
      out="$out$sep{\\"name\\": \\"$n\\", \\"state\\": \\"\${STUB_ASSET_STATE:-uploaded}\\"}"; sep=,
    done
    if [ -f "$STUB_DIR/published" ]; then imm=\${STUB_IMMUTABLE_AFTER:-true}; else imm=false; fi
    echo "{\\"id\\": 4242, \\"assets\\": [$out], \\"immutable\\": $imm}" ;;
  "PATCH $STUB_API_ROOT/releases/4242") printf '%s' "$body" > "$STUB_DIR/patch-body.json"; touch "$STUB_DIR/published"; echo '{"id": 4242}' ;;
  "GET $STUB_API_ROOT/git/ref/tags/"*)
    echo "{\\"object\\": {\\"sha\\": \\"\${STUB_TAG_SHA:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}\\", \\"type\\": \\"commit\\"}}" ;;
  "GET $STUB_API_ROOT/actions/runs/777")
    corr=$(cat "$STUB_DIR/corr")
    st=\${STUB_RUN_STATUS:-completed}
    if [ "$st" = completed ]; then concl="\\"\${STUB_CONCLUSION:-success}\\""; else concl=null; fi
    echo "{\\"display_title\\": \\"macos-build v0.20.0 [$corr]\\", \\"status\\": \\"$st\\", \\"conclusion\\": $concl}" ;;
  *) ;;
esac
`;

type Run = { status: number; stderr: string; stdout: string; calls: string[]; dispatchBody: string; createBody: string; patchBody: string };

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Runs a copy of the script against the stub client; the package.json version and the stub answers come from env. */
function run(script: string, env: Record<string, string> = {}, pkgVersion = "0.20.0"): Run {
  const dir = mkdtempSync(path.join(tmpdir(), "release-stage-"));
  dirs.push(dir);
  const bin = path.join(dir, "bin");
  const dist = path.join(dir, "dist");
  const src = path.join(dir, "src");
  for (const d of [bin, dist, src]) mkdirSync(d);
  writeFileSync(path.join(bin, "curl"), STUB_CURL);
  chmodSync(path.join(bin, "curl"), 0o755);
  writeFileSync(path.join(src, "package.json"), JSON.stringify({ name: "s3-browser", version: pkgVersion }));
  for (const f of ["S3 Browser-0.20.0.AppImage", "S3 Browser Setup 0.20.0.exe", "S3 Browser 0.20.0.exe", "sbom.cdx.json"]) {
    writeFileSync(path.join(dist, f), "x");
  }
  const scriptPath = path.join(dir, "release-stage.sh");
  writeFileSync(scriptPath, script);
  const r = spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      STUB_DIR: dir,
      STUB_API_ROOT: API,
      GITHUB_API: "https://api.github.com",
      REPO: "o/r",
      VERSION: "v0.20.0",
      RELEASE_SHA: SHA,
      DIST: dist,
      SOURCE_DIR: src,
      GH_TOKEN: "test-token",
      POLL_SECONDS: "0",
      RETRY_SECONDS: "0",
      ...env,
    },
  });
  const read = (f: string) => {
    try {
      return readFileSync(path.join(dir, f), "utf8");
    } catch {
      return "";
    }
  };
  return {
    status: r.status ?? -1,
    stderr: r.stderr,
    stdout: r.stdout,
    calls: read("calls.log").split("\n").filter(Boolean),
    dispatchBody: read("dispatch-body.json"),
    createBody: read("create-body.json"),
    patchBody: read("patch-body.json"),
  };
}

const count = (calls: string[], prefix: string) => calls.filter((c) => c.startsWith(prefix)).length;
const DRAFT_CREATE = `POST ${API}/releases `;
const DRAFT_DELETE = `DELETE ${API}/releases/4242 `;

/** Why a refused run is not the refusal the criterion asks for: non-zero, nothing created, nothing to delete. */
function refusalProblems(r: Run): string[] {
  const p: string[] = [];
  if (r.status === 0) p.push("exit status is 0");
  if (count(r.calls, DRAFT_CREATE) !== 0) p.push(`${count(r.calls, DRAFT_CREATE)} draft-create call(s)`);
  if (count(r.calls, "DELETE ") !== 0) p.push("a DELETE was issued");
  return p;
}

/** Why a run whose macOS leg failed did not clean up: non-zero and DELETE of the draft by its id. */
function macFailureProblems(r: Run): string[] {
  const p: string[] = [];
  if (r.status === 0) p.push("exit status is 0");
  if (count(r.calls, DRAFT_CREATE) !== 1) p.push("the draft was not created once");
  if (count(r.calls, DRAFT_DELETE) !== 1) p.push("the draft id was not deleted");
  return p;
}

describe("ci/release-stage.sh pre-publish steps", () => {
  it("creates the draft by REST, uploads the assets and the sbom to its id, dispatches the macOS build and waits for it", () => {
    const r = run(REAL);
    expect(r.stderr).not.toContain("FAILED");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("draft-id=4242");
    expect(count(r.calls, DRAFT_CREATE)).toBe(1);
    const uploads = r.calls.filter((c) => c.startsWith("POST https://uploads.github.com/"));
    expect(uploads.map((u) => u.split(" ")[1].replace(/^.*\/releases\/4242\/assets\?name=/, "")).sort()).toEqual([
      "S3%20Browser%20Setup%200.20.0.exe",
      "S3%20Browser%200.20.0.exe",
      "S3%20Browser-0.20.0.AppImage",
      "sbom.cdx.json",
    ].sort());
    expect(JSON.parse(r.createBody)).toMatchObject({ tag_name: "v0.20.0", target_commitish: SHA, draft: true, prerelease: false });
    const body = JSON.parse(r.dispatchBody);
    expect(body).toMatchObject({
      ref: "master",
      return_run_details: true,
      inputs: { tag: "v0.20.0", sha: SHA, release_id: "4242" },
    });
    expect(body.inputs.correlation_id).toMatch(/^jenkins-/);
    expect(r.calls.filter((c) => c.startsWith("GET " + API + "/actions/runs/777")).length).toBeGreaterThan(0);
    expect(count(r.calls, "DELETE ")).toBe(0);
  });

  it("sends X-GitHub-Api-Version 2026-03-10 on every GitHub call", () => {
    const r = run(REAL);
    const api = r.calls.filter((c) => c.includes("//api.github.com/") || c.includes("//uploads.github.com/"));
    expect(api.length).toBeGreaterThan(5);
    expect(api.filter((c) => !c.endsWith("version=2026-03-10"))).toEqual([]);
  });

  it("marks a -pre version as a prerelease draft", () => {
    const r = run(REAL, { VERSION: "v0.20.0-rc.1", STUB_API_ROOT: API, STUB_VERSION: "0.20.0-rc.1" }, "0.20.0-rc.1");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.createBody)).toMatchObject({ tag_name: "v0.20.0-rc.1", draft: true, prerelease: true });
    expect(JSON.parse(r.patchBody)).toEqual({ draft: false, prerelease: true, make_latest: "false" });
  });

  describe("refuses before creating a draft", () => {
    it("when the tag exists", () => {
      const r = run(REAL, { STUB_TAG_EXISTS: "1" });
      expect(refusalProblems(r)).toEqual([]);
      expect(r.stderr).toContain("tag v0.20.0 already exists");
    });

    it("when package.json's version differs from VERSION without the v", () => {
      const r = run(REAL, {}, "0.19.0");
      expect(refusalProblems(r)).toEqual([]);
      expect(r.stderr).toContain("package.json version 0.19.0 differs from 0.20.0");
    });

    it("when immutable releases are disabled", () => {
      const r = run(REAL, { STUB_IMMUTABLE: "false" });
      expect(refusalProblems(r)).toEqual([]);
      expect(r.stderr).toContain("immutable releases are off");
    });

    it("when VERSION is not vMAJOR.MINOR.PATCH", () => {
      const r = run(REAL, { VERSION: "0.20.0" });
      expect(refusalProblems(r)).toEqual([]);
    });
  });

  describe("deletes the draft by its id when a step fails before publish", () => {
    it("when the macOS run concludes failure", () => {
      const r = run(REAL, { STUB_CONCLUSION: "failure" });
      expect(macFailureProblems(r)).toEqual([]);
      expect(r.stderr).toContain("concluded failure");
    });

    it("when the macOS run does not finish before the deadline (the run is cancelled too)", () => {
      const r = run(REAL, { STUB_RUN_STATUS: "in_progress", MAC_TIMEOUT_MIN: "0" });
      expect(macFailureProblems(r)).toEqual([]);
      expect(count(r.calls, `POST ${API}/actions/runs/777/cancel `)).toBe(1);
    });

    it("is red for the macOS-failure case with the trap removed", () => {
      const noTrap = REAL.replace(/^trap on_exit EXIT$/m, "");
      expect(noTrap).not.toBe(REAL);
      const r = run(noTrap, { STUB_CONCLUSION: "failure" });
      expect(r.status).not.toBe(0);
      expect(macFailureProblems(r)).toEqual(["the draft id was not deleted"]);
    });
  });

  describe("verify, publish and the immutable check", () => {
    const releaseGet = `GET ${API}/releases/4242 `;
    const publish = `PATCH ${API}/releases/4242 `;
    const indexOf = (calls: string[], prefix: string, from = 0) => calls.findIndex((c, i) => i >= from && c.startsWith(prefix));
    /** The release is published: one draft=false PATCH, and no DELETE. */
    const publishedProblems = (r: Run): string[] => {
      const p: string[] = [];
      if (count(r.calls, publish) !== 1) p.push("not exactly one publish PATCH");
      if (count(r.calls, "DELETE ") !== 0) p.push("a DELETE was issued");
      return p;
    };

    it("publishes a verified draft with PATCH draft=false and make_latest, then reads tag and immutable", () => {
      const r = run(REAL);
      expect(r.status).toBe(0);
      expect(r.stderr).toContain("is immutable");
      expect(publishedProblems(r)).toEqual([]);
      expect(JSON.parse(r.patchBody)).toEqual({ draft: false, prerelease: false, make_latest: "true" });
      const patch = indexOf(r.calls, publish);
      const verify = indexOf(r.calls, releaseGet);
      expect(verify).toBeGreaterThan(-1);
      expect(verify).toBeLessThan(patch);
      expect(indexOf(r.calls, `GET ${API}/git/ref/tags/v0.20.0 `, patch)).toBeGreaterThan(patch);
      expect(indexOf(r.calls, releaseGet, patch)).toBeGreaterThan(patch); // immutable is read after the publish
    });

    it("expects the six assets of 0.20.0 (the verify accepts exactly that set)", () => {
      expect(REAL).toContain('S3.Browser-$V.AppImage S3.Browser.Setup.$V.exe S3.Browser.$V.exe S3.Browser-$V.dmg S3.Browser-$V-arm64.dmg sbom.cdx.json');
      expect(run(REAL).status).toBe(0);
    });

    it("DRY_RUN=true deletes the verified draft: zero draft=false PATCHes, one DELETE, exit 0", () => {
      const r = run(REAL, { DRY_RUN: "true" });
      expect(r.status).toBe(0);
      expect(count(r.calls, publish)).toBe(0);
      expect(count(r.calls, DRAFT_DELETE)).toBe(1);
      expect(count(r.calls, "DELETE ")).toBe(1);
      expect(r.patchBody).toBe("");
    });

    it("DRY_RUN case is red with the DRY_RUN guard removed", () => {
      const noGuard = REAL.replace('if [ "$DRY_RUN" = true ]; then', "if false; then");
      expect(noGuard).not.toBe(REAL);
      const r = run(noGuard, { DRY_RUN: "true" });
      expect(count(r.calls, publish)).toBe(1);
      expect(count(r.calls, DRAFT_DELETE)).toBe(0);
    });

    it("a draft missing S3.Browser-0.20.0-arm64.dmg fails the verify and is deleted, never published", () => {
      const r = run(REAL, { STUB_OMIT: "S3.Browser-0.20.0-arm64.dmg" });
      expect(macFailureProblems(r)).toEqual([]);
      expect(count(r.calls, publish)).toBe(0);
      expect(r.stderr).toContain("missing S3.Browser-0.20.0-arm64.dmg");
    });

    it("a draft with an asset not in state uploaded fails the verify and is deleted", () => {
      const r = run(REAL, { STUB_ASSET_STATE: "starter" });
      expect(macFailureProblems(r)).toEqual([]);
      expect(count(r.calls, publish)).toBe(0);
      expect(r.stderr).toContain("not uploaded");
    });

    it("a release reading immutable: false after the publish exits non-zero and is not deleted", () => {
      const r = run(REAL, { STUB_IMMUTABLE_AFTER: "false" });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("immutable: false");
      expect(publishedProblems(r)).toEqual([]);
    });

    it("a tag that does not point at the candidate sha exits non-zero and is not deleted", () => {
      const r = run(REAL, { STUB_TAG_SHA: "b".repeat(40) });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("not " + SHA);
      expect(publishedProblems(r)).toEqual([]);
    });

    it("rejects a DRY_RUN that is neither true nor false before creating anything", () => {
      expect(refusalProblems(run(REAL, { DRY_RUN: "yes" }))).toEqual([]);
    });
  });
});
