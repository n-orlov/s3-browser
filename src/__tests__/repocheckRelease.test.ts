import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/** The pipeline file with `//` comment lines dropped. */
function codeOf(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

/** The body of the first `<head> { ... }` block at or after `from`, by brace matching. */
function blockOf(code: string, head: RegExp, from = 0): string {
  const m = head.exec(code.slice(from));
  if (!m) return "";
  const open = from + m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(open + 1, i);
  }
  return "";
}

const root = path.join(__dirname, "..", "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

type Files = { release: string; main: string; script: string };
const real: Files = { release: read("Jenkinsfile.release"), main: read("Jenkinsfile"), script: read("ci/release-stage.sh") };
const spec = read("SPEC.md");

/** The real files with one property of one of them removed; throws if the edit did not apply. */
function without(file: keyof Files, from: string | RegExp, to: string): Files {
  const out = real[file].replace(from, to);
  if (out === real[file]) throw new Error(`fixture edit ${String(from)} did not apply`);
  return { ...real, [file]: out };
}

const STAGES = ["Candidate", "Checkout", "Version check", "Build", "Draft", "macOS", "Verify", "Publish"];
/** The phase of ci/release-stage.sh each stage other than Candidate, Checkout and Build runs. */
const PHASES: Record<string, string> = { "Version check": "check", Draft: "draft", macOS: "macos", Verify: "verify", Publish: "publish" };

/** One problem string per property of the release flow the pipeline files lack. */
function releaseProblems(files: Files): string[] {
  const problems: string[] = [];
  const code = codeOf(files.release);
  const pipeline = blockOf(code, /^pipeline\s*\{/m);
  if (!pipeline) return ["Jenkinsfile.release is not a declarative pipeline"];

  // Agent, options, parameters.
  const agent = /^ {2}agent \{ label '([^']*)' \}/m.exec(pipeline)?.[1];
  if (agent !== "amd64 && docker && s3-browser") problems.push(`the pipeline agent label is ${agent ?? "unset"}, expected amd64 && docker && s3-browser`);
  const options = blockOf(pipeline, /\boptions\s*\{/);
  for (const o of ["skipDefaultCheckout()", "disableConcurrentBuilds()"]) {
    if (!options.includes(o)) problems.push(`options lack ${o}`);
  }
  const parameters = blockOf(pipeline, /\bparameters\s*\{/);
  if (!/\bstring\(name: 'VERSION'/.test(parameters)) problems.push("no VERSION parameter");
  if (!/\bstring\(name: 'CI_BUILD'/.test(parameters)) problems.push("no CI_BUILD parameter");
  if (!/\bbooleanParam\(name: 'DRY_RUN'/.test(parameters)) problems.push("no DRY_RUN parameter");

  // Stage order, and no stage swaps the agent (they share one workspace: dist/ and the draft id).
  const stages = blockOf(pipeline, /\bstages\s*\{/);
  const names = [...stages.matchAll(/^ {4}stage\('([^']+)'\)/gm)].map((m) => m[1]);
  if (names.join(" > ") !== STAGES.join(" > ")) problems.push(`stages are ${names.join(" > ")}, expected ${STAGES.join(" > ")}`);
  if (/^ {6}agent\b/m.test(stages)) problems.push("a stage declares its own agent");
  const stageOf = (name: string) => blockOf(stages, new RegExp(`^ {4}stage\\('${name}'\\)\\s*\\{`, "m"));

  // Candidate: VERSION shape, then the candidate of a green master build by the right selector.
  const candidate = stageOf("Candidate");
  if (!/params\.VERSION ==~ \/\^v\\d\+\\\.\\d\+\\\.\\d\+\(-\[0-9A-Za-z\.-\]\+\)\?\$\//.test(candidate)) problems.push("Candidate does not validate VERSION as vMAJOR.MINOR.PATCH[-pre]");
  const copy = /copyArtifacts [^\n]*\n(?:[^\n]*\n){0,2}/.exec(candidate)?.[0] ?? "";
  if (!/projectName: '\/?s3-browser\/ci\/master'/.test(copy)) problems.push("Candidate does not copy from s3-browser/ci/master");
  if (!/filter: 'release-candidate\.json'/.test(copy)) problems.push("Candidate does not copy release-candidate.json");
  if (!/params\.CI_BUILD \? specific\(params\.CI_BUILD\) : lastSuccessful\(/.test(copy)) problems.push("the selector is not specific(CI_BUILD) or lastSuccessful()");
  if (/lastCompleted|lastBuild|latestSavedBuild|permalink/.test(copy)) problems.push("the selector admits a build that was not green");
  if (!/env\.RELEASE_SHA = sh\(returnStdout: true[\s\S]*?\["sha"\]/.test(candidate)) problems.push("Candidate does not read RELEASE_SHA from the sha of release-candidate.json");

  // Checkout: the tree is the candidate sha, never master's tip.
  const checkout = stageOf("Checkout");
  if (!/git checkout --quiet --detach "\$RELEASE_SHA"/.test(checkout)) problems.push("Checkout does not detach at the candidate sha");
  if (!/git rev-parse HEAD\)" = "\$RELEASE_SHA"/.test(checkout)) problems.push("Checkout does not check that HEAD is the candidate sha");
  if (/git (checkout|switch|reset)[^\n]*\b(master|origin\/master|FETCH_HEAD)\b/.test(checkout)) problems.push("Checkout moves to master instead of the candidate sha");

  // Build and the GitHub phases.
  if (!/sh 'ci\/release-build\.sh --sha "\$RELEASE_SHA" --out "\$DIST"'/.test(stageOf("Build"))) problems.push("Build does not run ci/release-build.sh at the candidate sha");
  for (const [stage, phase] of Object.entries(PHASES)) {
    const body = stageOf(stage);
    const call = new RegExp(`sh 'ci/release-stage\\.sh ${phase}'`);
    if (!call.test(body)) problems.push(`${stage} does not run ci/release-stage.sh ${phase}`);
    const guarded = blockOf(body, /withCredentials\(\[usernamePassword\(credentialsId: 'github-n-orlov'[^\n]*\{/);
    if (!call.test(guarded)) problems.push(`${stage} runs the script outside withCredentials`);
  }

  // Publish: the DRY_RUN guard, then the script's own order: the dry-run delete, the publish PATCH, the immutable read.
  if (!/environment \{ DRY_RUN = "\$\{params\.DRY_RUN\}" \}/.test(stageOf("Publish"))) problems.push("Publish does not pass DRY_RUN from the parameter");
  if (names[names.length - 1] !== "Publish") problems.push("Publish is not the last stage");
  const publish = blockOf(codeOf(files.script), /^phase_publish\(\)\s*\{/m);
  const dry = publish.indexOf('if [ "$DRY_RUN" = true ]; then');
  const patch = publish.indexOf('api PATCH "repos/$REPO/releases/$RELEASE_ID"');
  const immutable = publish.indexOf("immutable=$(api GET");
  const immutableCheck = publish.indexOf('[ "$immutable" = true ] || die');
  if (dry < 0 || patch < 0 || dry > patch) problems.push("the DRY_RUN guard does not come before the publish PATCH");
  if (!/DELETE/.test(publish.slice(dry, patch))) problems.push("the DRY_RUN branch does not delete the verified draft");
  if (immutable < 0 || immutable < patch || immutableCheck < immutable) problems.push("the immutable check is not read, and enforced, after the publish");
  if (!/\[ "\$tag_sha" = "\$RELEASE_SHA" \] \|\| die/.test(publish)) problems.push("the tag is not checked against the candidate sha");
  if (!/DRY_RUN:\?/.test(files.script)) problems.push("the publish phase accepts an unset DRY_RUN");

  // post: archive, summary, draft deletion on failure and abort, Telegram.
  const post = blockOf(pipeline, /^ {2}post\s*\{/m);
  const always = blockOf(post, /\balways\s*\{/);
  if (!/currentBuild\.description = /.test(always) || !/\baddSummary\(/.test(always)) problems.push("post { always } writes no build-page summary");
  for (const cond of ["failure", "aborted"]) {
    const cleanup = blockOf(post, new RegExp(`\\b${cond}\\s*\\{`));
    if (!/ci\/release-stage\.sh cleanup'/.test(cleanup)) problems.push(`post { ${cond} } does not delete the draft (ci/release-stage.sh cleanup)`);
    else if (!/sh 'test -x ci\/release-stage\.sh \|\| \{[^']*exit 0; \}; ci\/release-stage\.sh cleanup'/.test(cleanup)) {
      problems.push(`post { ${cond} } runs the cleanup script unguarded: a build that failed in Candidate has no checkout, and the missing script errors the post condition`);
    }
  }
  const notify = blockOf(post, /\bcleanup\s*\{/);
  if (!/\btry\s*\{[\s\S]*\bnotifyTelegram\(/.test(notify)) problems.push("post does not call notifyTelegram best-effort (inside try)");
  if (!/\bcatch\b/.test(notify)) problems.push("a Telegram failure is not caught");

  // The candidate itself, from the CI Jenkinsfile.
  const main = codeOf(files.main);
  const mainPost = blockOf(blockOf(main, /^pipeline\s*\{/m), /^ {2}post\s*\{/m);
  const success = blockOf(mainPost, /\bsuccess\s*\{/);
  if (!/if \(env\.BRANCH_NAME == 'master'\) \{\s*archiveReleaseCandidate\(\)\s*\}/.test(success)) problems.push("post { success } does not archive the candidate for master builds only");
  if (/archiveReleaseCandidate\(\)/.test(mainPost.replace(success, ""))) problems.push("the candidate is archived outside post { success }");
  if (/release-candidate/.test(mainPost.replace(success, ""))) problems.push("release-candidate.json is mentioned outside post { success }");
  const helper = blockOf(main, /^def archiveReleaseCandidate\(\)\s*\{/m);
  if (!/"\{\\"job\\": \\"\$\{env\.JOB_NAME\}\\", \\"build\\": \$\{env\.BUILD_NUMBER\}, \\"sha\\": \\"\$\{env\.GATE_SHA\}\\"\}/.test(helper)) problems.push("release-candidate.json does not carry job, build number and sha");
  if (!/archiveArtifacts artifacts: 'release-candidate\.json'/.test(helper)) problems.push("the candidate is not archived");
  return problems;
}

const FIXTURES: Record<string, Files> = {
  "selectLastCompleted (lastCompleted selector)": without("release", "lastSuccessful(stable: true)", "lastCompleted()"),
  "selectLastBuild (lastBuild selector)": without("release", "lastSuccessful(stable: true)", "lastBuild()"),
  "noSpecific (CI_BUILD ignored)": without("release", /params\.CI_BUILD \? specific\(params\.CI_BUILD\) : /, ""),
  "fromPrJob (candidate from another job)": without("release", "'/s3-browser/ci/master'", "'/s3-browser/ci/PR-30'"),
  "checkoutMaster (builds master's tip)": without("release", 'git checkout --quiet --detach "$RELEASE_SHA"', "git checkout --quiet master"),
  "checkoutScmOnly (builds whatever scm gave)": without("release", /\n\s*git checkout --quiet --detach "\$RELEASE_SHA"\n\s*test "\$\(git rev-parse HEAD\)" = "\$RELEASE_SHA"/, ""),
  "shaFromBranch (sha not from the candidate file)": without("release", '["sha"]', '["job"]'),
  "archiveInAlways (candidate archived in post { always })": {
    ...real,
    main: real.main
      .replace(/(\n {4}always \{\n {6}script \{\n)/, "$1        archiveReleaseCandidate()\n")
      .replace(/if \(env\.BRANCH_NAME == 'master'\) \{\n\s*archiveReleaseCandidate\(\)\n\s*\}\n\s*/, ""),
  },
  "archiveForAll (candidate archived for every branch)": without("main", /if \(env\.BRANCH_NAME == 'master'\) \{\n\s*archiveReleaseCandidate\(\)\n\s*\}/, "archiveReleaseCandidate()"),
  "noSha (candidate without sha)": without("main", ', \\"sha\\": \\"${env.GATE_SHA}\\"', ""),
  "noDraftCleanupOnFailure (no draft deletion in post { failure })": without("release", /\n {4}failure \{[\s\S]*?\n {4}\}\n/, "\n"),
  "noDraftCleanupOnAbort (no draft deletion in post { aborted })": without("release", /\n {4}aborted \{[\s\S]*?\n {4}\}\n/, "\n"),
  "cleanupUnguarded (post { failure } runs a script that a Candidate failure never checked out)": {
    ...real,
    release: real.release.replace(/sh 'test -x ci\/release-stage\.sh \|\| \{[^']*exit 0; \}; ci\/release-stage\.sh cleanup'/, "sh 'ci/release-stage.sh cleanup'"),
  },
  "noDryRunEnv (Publish without the DRY_RUN parameter)": without("release", /\n {6}environment \{ DRY_RUN = "\$\{params\.DRY_RUN\}" \}/, ""),
  "dryRunAfterPatch (DRY_RUN guard after the publish PATCH)": {
    ...real,
    script: real.script
      .replace('if [ "$DRY_RUN" = true ]; then', "if false; then")
      .replace('  log "release $RELEASE_ID published"', '  if [ "$DRY_RUN" = true ]; then api DELETE "repos/$REPO/releases/$RELEASE_ID" >/dev/null; return 0; fi\n  log "release $RELEASE_ID published"'),
  },
  "noImmutableCheck (immutable never enforced)": without("script", '  [ "$immutable" = true ] || die "PUBLISHED but release $RELEASE_ID reads immutable: ${immutable:-unknown}"\n', ""),
  "noTagCheck (tag not compared with the candidate sha)": without("script", '[ "$tag_sha" = "$RELEASE_SHA" ] || die', "true || die"),
  "dryRunDefault (publish guesses DRY_RUN)": without("script", '  : "${DRY_RUN:?}"\n', ""),
  "noNotify (no Telegram)": without("release", /\n\s*notifyTelegram\([^)]*\)\)?/, ""),
  "notifyUncaught (Telegram failure fails the build)": without("release", /\s*catch \(err\) \{\n\s*echo "Telegram[^\n]*\n\s*\}/, ""),
  "noSummary (no build-page summary)": without("release", /\n\s*addSummary\(icon:[\s\S]*?text: text\)/, ""),
  "stageOrder (Draft before Build)": {
    ...real,
    release: real.release.replace("stage('Build')", "stage('__')").replace("stage('Draft')", "stage('Build')").replace("stage('__')", "stage('Draft')"),
  },
  "buildOnArm (wrong agent label)": without("release", "agent { label 'amd64 && docker && s3-browser' }", "agent { label 'arm64 && docker && s3-browser' }"),
  "stageAgent (Build on its own agent)": without("release", "      options { timeout(time: 40, unit: 'MINUTES') }", "      agent { label 'arm64' }\n      options { timeout(time: 40, unit: 'MINUTES') }"),
  "buildScriptGone (Build without ci/release-build.sh)": without("release", "ci/release-build.sh --sha", "ci/other-build.sh --sha"),
  "noCredentials (macOS outside withCredentials)": without("release", /(stage\('macOS'\)[\s\S]*?)withCredentials\(\[[^\n]*\{\n\s*(sh 'ci\/release-stage\.sh macos')\n\s*\}/, "$1$2"),
  "noVersionCheck (VERSION unvalidated)": without("release", /if \(!\(params\.VERSION[^\n]*\n[^\n]*\n\s*\}\n/, ""),
  "noDryRunParam (no DRY_RUN parameter)": without("release", "booleanParam(name: 'DRY_RUN'", "booleanParam(name: 'DRYRUN'"),
};

describe("Jenkinsfile.release and the release candidate (repocheck)", () => {
  it("has no problem", () => {
    expect(releaseProblems(real)).toEqual([]);
  });

  it("lists the stages in the order Candidate, Checkout, Version check, Build, Draft, macOS, Verify, Publish", () => {
    const names = [...codeOf(real.release).matchAll(/^ {4}stage\('([^']+)'\)/gm)].map((m) => m[1]);
    expect(names).toEqual(STAGES);
  });

  it.each(Object.entries(FIXTURES))("is red for %s", (_name, fixture) => {
    expect(releaseProblems(fixture).length).toBeGreaterThan(0);
  });

  it("names the broken property for the selector, checkout, archive, deletion and DRY_RUN fixtures", () => {
    const f = Object.fromEntries(Object.entries(FIXTURES).map(([k, v]) => [k.split(" ")[0], releaseProblems(v).join("; ")]));
    expect(f.selectLastCompleted).toContain("selector");
    expect(f.selectLastBuild).toContain("selector");
    expect(f.noSpecific).toContain("selector");
    expect(f.fromPrJob).toContain("s3-browser/ci/master");
    expect(f.checkoutMaster).toContain("candidate sha");
    expect(f.checkoutScmOnly).toContain("candidate sha");
    expect(f.shaFromBranch).toContain("sha of release-candidate.json");
    expect(f.archiveInAlways).toContain("post { success }");
    expect(f.archiveForAll).toContain("master builds only");
    expect(f.noSha).toContain("job, build number and sha");
    expect(f.noDraftCleanupOnFailure).toContain("post { failure }");
    expect(f.noDraftCleanupOnAbort).toContain("post { aborted }");
    expect(f.cleanupUnguarded).toContain("no checkout");
    expect(f.noDryRunEnv).toContain("DRY_RUN");
    expect(f.dryRunAfterPatch).toContain("DRY_RUN guard");
    expect(f.noImmutableCheck).toContain("immutable");
    expect(f.noNotify).toContain("notifyTelegram");
    expect(f.stageOrder).toContain("stages are");
  });
});

describe("SPEC.md section 5 describes the release flow", () => {
  const section = spec.slice(spec.indexOf("## 5. CI topology"));
  const paragraph = section.split("\n").find((l) => l.startsWith("- **Release pipeline (`Jenkinsfile.release`")) ?? "";

  it("has the Jenkinsfile.release paragraph", () => {
    expect(paragraph).not.toBe("");
    for (const needle of [
      "`Candidate`", "`Checkout`", "`Version check`", "`Build`", "`Draft`", "`macOS`", "`Verify`", "`Publish`",
      "release-candidate.json", "lastSuccessful", "specific(CI_BUILD)", "post { success }", "env.BRANCH_NAME == 'master'",
      "post { failure }", "post { aborted }", "notifyTelegram", "addSummary", "immutable: true", "What stays on GitHub",
    ]) {
      expect(paragraph).toContain(needle);
    }
  });
});
