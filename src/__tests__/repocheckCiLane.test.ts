import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/** The Jenkinsfile with `//` comment lines dropped. */
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

/** The ten Quality steps, in the order the stage must run them. */
const QUALITY_ORDER: ReadonlyArray<readonly [string, RegExp]> = [
  ["npm ci", /nodeSh\('npm ci\b/],
  ["typecheck", /nodeSh\('npm run typecheck'\)/],
  ["lint", /nodeSh\('npm run lint'\)/],
  ["test:coverage", /nodeSh\('npm run test:coverage'\)/],
  ["crap", /nodeSh\('npm run crap'\)/],
  ["ratchet:check", /nodeSh\('npm run ratchet:check'\)/],
  ["audit:prod", /nodeSh\('npm run audit:prod'\)/],
  ["ci/trivy.sh", /\bsh 'ci\/trivy\.sh'/],
  ["build", /nodeSh\('npm run build'\)/],
  ["sbom", /nodeSh\('npm run sbom'\)/],
];

/** One problem string per property of the Jenkins CI lane the Jenkinsfile lacks. */
function laneProblems(jenkinsfile: string): string[] {
  const problems: string[] = [];
  const code = codeOf(jenkinsfile);

  if (!/^@Library\('homelab'\)\s+_/m.test(code)) problems.push("does not load @Library('homelab')");
  if (!/^pipeline\s*\{/m.test(code)) problems.push("is not a declarative pipeline");

  const pipeline = blockOf(code, /^pipeline\s*\{/m);
  const options = blockOf(pipeline, /\boptions\s*\{/);
  const optionChecks: Array<[string, RegExp]> = [
    ["ansiColor", /\bansiColor\('xterm'\)/],
    ["timestamps", /\btimestamps\(\)/],
    ["buildDiscarder", /\bbuildDiscarder\(logRotator\(numToKeepStr: '\d+'\)\)/],
    ["disableConcurrentBuilds", /\bdisableConcurrentBuilds\(\)/],
    ["copyArtifactPermission", /\bcopyArtifactPermission\('\/s3-browser\/release,\/s3-browser\/ci\/\*'\)/],
    ["timeout", /\btimeout\(time: \d+, unit: 'MINUTES'\)/],
  ];
  for (const [name, re] of optionChecks) {
    if (!re.test(options)) problems.push(`options lack ${name}`);
  }

  const stagesStart = pipeline.search(/\bstages\s*\{/);
  const stages = blockOf(pipeline, /\bstages\s*\{/);
  const quality = blockOf(stages, /\bstage\('Quality'\)\s*\{/);
  if (!quality) {
    problems.push("no Quality stage");
    return problems;
  }
  if (stagesStart < 0) problems.push("no stages block");

  const agent = blockOf(quality, /\bagent\s*\{/);
  const label = /\blabel\s+'([^']*)'/.exec(agent)?.[1];
  if (label !== "arm64 && docker && s3-browser") {
    problems.push(`Quality label is ${label ?? "unset"}, expected arm64 && docker && s3-browser`);
  }
  const stageOptions = blockOf(quality, /\boptions\s*\{/);
  if (!/\btimeout\(time: \d+, unit: 'MINUTES'\)/.test(stageOptions)) problems.push("Quality has no stage timeout");
  if (!/\bsh 'git clean -ffdxq'/.test(quality)) problems.push("Quality does not reset with git clean -ffdxq");

  // Every Node step goes through nodeSh, which runs a node:22 container with a memory cap.
  const helper = blockOf(code, /^def nodeSh\(String cmd\)\s*\{/m);
  if (!/\bdocker run\b/.test(helper)) problems.push("nodeSh does not run docker");
  if (!/(^|\s)node:22(\s|$)/m.test(helper)) problems.push("nodeSh does not use the node:22 image");
  if (!/--memory \d+[gm]\b/.test(helper)) problems.push("the Node container has no --memory cap");

  const steps = blockOf(quality, /\bsteps\s*\{/);
  const positions = QUALITY_ORDER.map(([name, re]) => ({ name, at: steps.search(re) }));
  for (const { name, at } of positions) {
    if (at < 0) problems.push(`Quality lacks the ${name} step`);
  }
  const present = positions.filter((p) => p.at >= 0);
  for (let i = 1; i < present.length; i++) {
    if (present[i].at < present[i - 1].at) {
      problems.push(`Quality runs ${present[i].name} before ${present[i - 1].name}`);
    }
  }
  return problems;
}

/** One problem string per property of the jenkins/gate commit status the Jenkinsfile lacks. */
function gateProblems(jenkinsfile: string): string[] {
  const problems: string[] = [];
  const code = codeOf(jenkinsfile);

  const post = blockOf(code, /^def postGate\(String state, String desc\)\s*\{/m);
  if (!post) {
    problems.push("no postGate helper");
    return problems;
  }
  if (!/"context\\*":\\*"jenkins\/gate\\*"/.test(post)) problems.push("postGate does not post the context jenkins/gate");
  if (!/api\.github\.com\/repos\/n-orlov\/s3-browser\/statuses\/\$GATE_SHA/.test(post)) {
    problems.push("postGate does not post to the statuses API of the gate sha");
  }
  if (!/\$BUILD_URL|\$\{BUILD_URL\}/.test(post) || !/target_url/.test(post)) problems.push("postGate sets no target_url of the build");
  const creds = blockOf(post, /\bwithCredentials\(\[[^\n]*\]\)\s*\{/);
  if (!/credentialsId: 'github-n-orlov'/.test(post)) problems.push("postGate does not use the credential github-n-orlov");
  if (!creds) problems.push("postGate has no withCredentials block");

  // The token is read only inside a withCredentials body.
  const head = /\bwithCredentials\(\[[^\n]*\]\)\s*\{/;
  let outside = code;
  for (const m of code.matchAll(new RegExp(head.source, "g"))) {
    const body = blockOf(code, head, m.index);
    outside = outside.replace(code.slice(m.index, m.index + m[0].length + body.length + 1), "");
  }
  const stripped = outside.replace(/passwordVariable: 'GH_TOKEN'/g, "");
  if (/GH_TOKEN/.test(stripped)) problems.push("the token GH_TOKEN is used outside withCredentials");

  const states = [...post.matchAll(/GATE_STATE/g)].length;
  if (states === 0) problems.push("postGate posts no state");
  const pipeline = blockOf(code, /^pipeline\s*\{/m);
  const stages = blockOf(pipeline, /\bstages\s*\{/);
  if (!/\bpostGate\('pending',/.test(stages)) problems.push("no pending status at the start of the build");
  const postBlock = blockOf(pipeline, /^ {2}post\s*\{/m);
  const success = blockOf(postBlock, /\bsuccess\s*\{/);
  if (!/\bfinishGate\('success',/.test(success)) problems.push("no success status in post { success }");
  if (/\bfinishGate\('success',/.test(postBlock.replace(success, ""))) problems.push("success is posted outside post { success }");
  const unsuccessful = blockOf(postBlock, /\bunsuccessful\s*\{/);
  if (!/\bfinishGate\('failure',/.test(unsuccessful)) problems.push("no failure status in post { unsuccessful } (FAILURE and ABORTED)");
  if (!/GATE_STAGE/.test(unsuccessful)) problems.push("the failure description does not name the failed stage");
  const gateSha = blockOf(code, /^def gateSha\(\)\s*\{/m);
  if (!/HEAD\^1/.test(gateSha) || !/HEAD\^2/.test(gateSha)) problems.push("gateSha does not take the first parent of a merge commit");
  return problems;
}

/** One problem string per property of the sharded E2E stage the Jenkinsfile lacks. */
function e2eProblems(jenkinsfile: string): string[] {
  const problems: string[] = [];
  const code = codeOf(jenkinsfile);
  const stages = blockOf(blockOf(code, /^pipeline\s*\{/m), /\bstages\s*\{/);
  const e2e = blockOf(stages, /\bstage\('E2E'\)\s*\{/);
  if (!e2e) return ["no E2E stage"];
  const parallel = blockOf(e2e, /\bparallel\s*\{/);
  if (!parallel) problems.push("E2E does not run its shards in parallel");
  const shards = [...parallel.matchAll(/\bstage\('[^']*'\)\s*\{/g)].map((m) => blockOf(parallel, new RegExp(m[0].replace(/[()]/g, "\\$&")  )));
  if (shards.length !== 3) problems.push(`E2E has ${shards.length} shards, expected 3`);
  shards.forEach((shard, n) => {
    if (!new RegExp(`\\be2eShard\\(${n + 1}\\)`).test(shard)) problems.push(`shard ${n + 1} does not call e2eShard(${n + 1})`);
    if (!/\btimeout\(time: \d+, unit: 'MINUTES'\)/.test(blockOf(shard, /\boptions\s*\{/))) problems.push(`shard ${n + 1} has no stage timeout`);
    const post = blockOf(shard, /\bpost\s*\{/);
    for (const cond of ["aborted", "cleanup"]) {
      if (!new RegExp(`\\be2eShardCleanup\\(${n + 1}\\)`).test(blockOf(post, new RegExp(`\\b${cond}\\s*\\{`)))) {
        problems.push(`shard ${n + 1} does not remove its containers and volumes in post { ${cond} }`);
      }
    }
  });
  const body = blockOf(code, /^def e2eShard\(int index\)\s*\{/m);
  if (!body) problems.push("no e2eShard helper");
  const nodeBody = blockOf(body, /\bnode\("([^"$]*)\$\{exclude\}"\)\s*\{/);
  const label = /\bnode\("([^"$]*)\$\{exclude\}"\)/.exec(body)?.[1];
  if (label !== "arm64 && docker && s3-browser") problems.push(`the shard node label is ${label ?? "unset"}, expected arm64 && docker && s3-browser`);
  const locked = blockOf(nodeBody, /\block\(resource: "s3b-e2e-\$\{env\.NODE_NAME\}"(, skipIfLocked: true)?\)\s*\{/);
  if (!locked) problems.push("the shard body is not inside lock(resource: \"s3b-e2e-${env.NODE_NAME}\")");
  if (!/scripts\/e2e-docker\.sh --shard=\$\{index\}\/3/.test(locked)) problems.push("the lock does not wrap scripts/e2e-docker.sh --shard=<i>/3");
  if (!/\bgateStage\('E2E'\)/.test(body)) problems.push("the shard does not name its stage for the gate");
  const cleanup = blockOf(code, /^def e2eShardCleanup\(int index\)\s*\{/m);
  if (!/docker rm -fv\b/.test(cleanup)) problems.push("the cleanup does not remove containers with their volumes (docker rm -fv)");
  if (!/docker volume rm\b/.test(cleanup)) problems.push("the cleanup does not remove volumes");
  if (!/s3b-\.\*-\$\{tag\}/.test(cleanup)) problems.push("the cleanup does not select the shard's s3b- containers");
  return problems;
}

/** The packaging paths ci.yml's `changes` job lists, with the release definition files in place of release.yml. */
const RELEASE_PATHS = [
  "package.json",
  "build/**",
  "electron-builder*",
  "Jenkinsfile.release",
  "ci/release-build.sh",
  "ci/release-stage.sh",
  "vite.config.*",
  "tsconfig*.json",
];

/** One problem string per property of the Release dry-run stage the Jenkinsfile lacks. */
function releaseProblems(jenkinsfile: string): string[] {
  const problems: string[] = [];
  const code = codeOf(jenkinsfile);
  const stages = blockOf(blockOf(code, /^pipeline\s*\{/m), /\bstages\s*\{/);
  const stage = blockOf(stages, /\bstage\('Release dry-run'\)\s*\{/);
  if (!stage) return ["no Release dry-run stage"];
  const label = /\blabel\s+'([^']*)'/.exec(blockOf(stage, /\bagent\s*\{/))?.[1];
  if (label !== "amd64 && docker && s3-browser") {
    problems.push(`Release dry-run label is ${label ?? "unset"}, expected amd64 && docker && s3-browser`);
  }
  if (!/\btimeout\(time: \d+, unit: 'MINUTES'\)/.test(blockOf(stage, /\boptions\s*\{/))) problems.push("Release dry-run has no stage timeout");

  const when = blockOf(stage, /\bwhen\s*\{/);
  if (!/\bbeforeAgent true\b/.test(when)) problems.push("Release dry-run does not decide before taking an agent (beforeAgent true)");
  const anyOf = blockOf(when, /\banyOf\s*\{/);
  if (!/^\s*branch 'master'\s*$/m.test(anyOf)) problems.push("Release dry-run does not run unconditionally on master (branch 'master')");
  if (!/expression\s*\{\s*env\.PACKAGING_CHANGED == 'true'\s*\}/.test(anyOf)) problems.push("Release dry-run does not run when a packaging path changed (PACKAGING_CHANGED)");

  const steps = blockOf(stage, /\bsteps\s*\{/);
  if (!/electron-builder --linux AppImage --x64 -p never\b/.test(steps)) problems.push("Release dry-run does not build electron-builder --linux AppImage --x64 -p never");
  if (/electron-builder\b[^\n]*\s-p\s+(?!never\b)/.test(steps)) problems.push("Release dry-run publishes");
  const build = steps.search(/electron-builder --linux/);
  const smoke = steps.search(/scripts\/smoke-appimage\.sh/);
  if (smoke < 0) problems.push("Release dry-run does not run scripts/smoke-appimage.sh");
  else if (build >= 0 && smoke < build) problems.push("Release dry-run smoke-tests before it builds the AppImage");

  const paths = blockOf(code, /^def releasePaths\(\)\s*\{/m);
  const listed = [...paths.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const p of RELEASE_PATHS) {
    if (!listed.includes(p)) problems.push(`the packaging path list lacks ${p}`);
  }
  if (listed.includes(".github/workflows/release.yml")) problems.push("the packaging path list still names release.yml");

  const quality = blockOf(stages, /\bstage\('Quality'\)\s*\{/);
  if (!/env\.PACKAGING_CHANGED = packagingChanged\(\)/.test(quality)) problems.push("Quality does not compute PACKAGING_CHANGED from the path list");
  const helper = blockOf(code, /^def packagingChanged\(\)\s*\{/m);
  if (!/git diff --name-only origin\/master\.\.\.HEAD/.test(helper) || !/S3B_RELEASE_PATHS/.test(helper)) {
    problems.push("packagingChanged does not match the changed files against the path list");
  }
  return problems;
}

/** One problem string per report step the Jenkinsfile's pipeline-level `post { always }` lacks. */
function reportProblems(jenkinsfile: string): string[] {
  const problems: string[] = [];
  const code = codeOf(jenkinsfile);
  const post = blockOf(blockOf(code, /^pipeline\s*\{/m), /^ {2}post\s*\{/m);
  const always = blockOf(post, /\balways\s*\{/);
  if (!always) return ["no post { always }"];
  if (!/\bjunit\s+testResults:[^\n]*junit\/junit\.xml/.test(always)) problems.push("post { always } does not record the unit JUnit (junit/junit.xml)");
  if (!/\bjunit\s+testResults:[^\n]*e2e-\*\/junit\/e2e-junit\.xml/.test(always)) problems.push("post { always } does not record the e2e JUnit");
  if (!/\bcopyArtifacts\b[^\n]*\n?[^\n]*lastCompleted\(\)/.test(always) || !/previous\/allure-history\/history\.jsonl/.test(always)) {
    problems.push("post { always } does not copy the previous build's Allure history with copyArtifacts");
  }
  if (!/\ballure@[\d.]+ generate\b/.test(always)) problems.push("post { always } does not generate the Allure report");
  const inputs = always.match(/for d in ([^;]*);/)?.[1] ?? "";
  for (const dir of ["allure-results-unit", "e2e-1/allure-results", "e2e-2/allure-results", "e2e-3/allure-results"]) {
    if (!inputs.includes(dir)) problems.push(`the Allure report does not take ${dir}`);
  }
  if (!/\bpublishHTML\(\[reportName: 'Allure'/.test(always)) problems.push("post { always } does not publish the Allure report with publishHTML");
  if (!/\bsummary\.ts html ci-summary\b/.test(always)) problems.push("post { always } does not render the CI summary page");
  if (!/\bpublishHTML\(\[reportName: 'CI summary', reportDir: 'ci-summary'/.test(always)) {
    problems.push("post { always } does not publish the CI summary page with publishHTML");
  }
  const archive = /\barchiveArtifacts\s+artifacts:\s*'([^']*)'/.exec(always)?.[1] ?? "";
  if (!archive) problems.push("post { always } archives nothing");
  for (const piece of ["coverage/", "reports/eslint.json", "sbom/", "reports/trivy.txt", "playwright-report/"]) {
    if (archive && !archive.includes(piece)) problems.push(`post { always } does not archive ${piece}`);
  }
  // The reports must not hang on the build's outcome.
  for (const step of ["junit", "publishHTML", "archiveArtifacts", "copyArtifacts"]) {
    const outside = post.replace(always, "");
    if (new RegExp(`\\b${step}\\b`).test(outside)) problems.push(`${step} sits outside post { always }`);
  }
  // What the reports are built from is stashed on every outcome.
  const stages = blockOf(blockOf(code, /^pipeline\s*\{/m), /\bstages\s*\{/);
  const qualityAlways = blockOf(blockOf(blockOf(stages, /\bstage\('Quality'\)\s*\{/), /\bpost\s*\{/), /\balways\s*\{/);
  if (!/stash name: 'quality-results'/.test(qualityAlways)) problems.push("Quality does not stash its results in post { always }");
  const shard = blockOf(code, /^def e2eShard\(int index\)\s*\{/m);
  if (!/\bfinally\s*\{[^}]*stash name: "e2e-results-\$\{index\}"/.test(shard)) problems.push("an e2e shard does not stash its results in a finally");
  return problems;
}

const real = readFileSync(path.join(__dirname, "..", "..", "Jenkinsfile"), "utf8");

/** The real Jenkinsfile with one property removed; throws if the edit did not apply. */
function without(from: string | RegExp, to: string): string {
  const out = real.replace(from, to);
  if (out === real) throw new Error(`fixture edit ${String(from)} did not apply`);
  return out;
}

/** The real Jenkinsfile with the lint step moved to just after the build step. */
function lintAfterBuild(): string {
  const lint = "        nodeSh('npm run lint')\n";
  const build = "        nodeSh('npm run build')\n";
  return without(lint, "").replace(build, build + lint);
}

const FIXTURES: Record<string, string> = {
  "Jenkinsfile.noConcurrencyGuard (without disableConcurrentBuilds)": without(/^\s*disableConcurrentBuilds\(\)\n/m, ""),
  "Jenkinsfile.noMemoryCap (without --memory)": without(/--memory 3g --memory-swap 3g/, ""),
  "Jenkinsfile.lintAfterBuild (lint moved after build)": lintAfterBuild(),
};

const GATE_FIXTURES: Record<string, string> = {
  "Jenkinsfile.ciGate (context renamed to ci/gate)": without(/jenkins\/gate(?=\\+")/, "ci/gate"),
  "Jenkinsfile.noFailurePost (without post { unsuccessful })": without(/\n {4}unsuccessful \{[\s\S]*?\n {4}\}\n/, "\n"),
  "Jenkinsfile.tokenOutside (token used outside withCredentials)": without("        sh 'git clean -ffdxq'\n", "        sh 'git clean -ffdxq'\n        sh 'curl -H \"Authorization: Bearer $GH_TOKEN\" https://api.github.com/user'\n"),
};

const E2E_FIXTURES: Record<string, string> = {
  "Jenkinsfile.noLock (shard body without lock)": without(/lock\(resource: "s3b-e2e-\$\{env\.NODE_NAME\}", skipIfLocked: true\) \{/, "if (true) {"),
  "Jenkinsfile.noCleanup (without post { aborted } and cleanup)": without(/\n {10}post \{\n {12}aborted \{[\s\S]*?\n {10}\}\n(?= {8}\}\n {8}stage\('E2E shard 2)/, "\n"),
  "Jenkinsfile.twoShards (shard count 2)": without(/ {8}stage\('E2E shard 3\/3'\) \{[\s\S]*?\n {8}\}\n(?= {6}\})/, ""),
  "Jenkinsfile.wrongLabel (shard on linux)": without('node("arm64 && docker && s3-browser${exclude}")', 'node("linux${exclude}")'),
};

const RELEASE_FIXTURES: Record<string, string> = {
  "Jenkinsfile.noX64 (electron-builder without --x64)": without(" --x64 -p never", " -p never"),
  "Jenkinsfile.noMasterCondition (without branch 'master')": without("          branch 'master'\n", ""),
  "Jenkinsfile.noSmoke (without the smoke call)": without(/ {8}sh 'S3B_SMOKE_DOCKER_ARGS[^\n]*\n/, ""),
  "Jenkinsfile.wrongLabel (Release dry-run on arm64)": without("agent { label 'amd64 && docker && s3-browser' }", "agent { label 'arm64 && docker && s3-browser' }"),
  "Jenkinsfile.noPackageJson (path list without package.json)": without("    'package.json',\n", ""),
};

const REPORT_FIXTURES: Record<string, string> = {
  "Jenkinsfile.junitOnSuccess (junit moved to post { success })": without(/ {10}junit testResults:[^\n]*\n[^\n]*\n(?= {10}\/\/ One Allure)/, "").replace(
    "    success {\n",
    "    success {\n      junit testResults: 'junit/junit.xml, e2e-*/junit/e2e-junit.xml', allowEmptyResults: true\n",
  ),
  "Jenkinsfile.noHistory (without the copyArtifacts history step)": without(/ {10}copyArtifacts projectName:[^\n]*\n[^\n]*\n/, ""),
  "Jenkinsfile.noPublish (without publishHTML)": without(/ {10}publishHTML\(\[reportName: 'Allure'[^\n]*\n[^\n]*\n/, ""),
  "Jenkinsfile.noSummaryPublish (without publishing the CI summary page)": without(/ {10}publishHTML\(\[reportName: 'CI summary'[^\n]*\n[^\n]*\n/, ""),
  "Jenkinsfile.noSummaryRender (without rendering the CI summary page)": without(/ {12}nodeSh\('node scripts\/summary\/summary\.ts html ci-summary'\)\n/, ""),
  "Jenkinsfile.noPlaywrightArchive (archive without the Playwright report)": without(", e2e-*/playwright-report/**", ""),
  "Jenkinsfile.noEslintArchive (archive without the ESLint JSON)": without(", reports/eslint.json", ""),
};

describe("the Jenkinsfile is the Jenkins CI lane (repocheck)", () => {
  it("is a declarative pipeline with @Library('homelab'), the six options and stage timeouts", () => {
    expect(laneProblems(real)).toEqual([]);
  });

  it("runs Quality on arm64 && docker && s3-browser in a memory-capped node:22 container", () => {
    const quality = blockOf(blockOf(blockOf(codeOf(real), /^pipeline\s*\{/m), /\bstages\s*\{/), /\bstage\('Quality'\)\s*\{/);
    expect(quality).toContain("label 'arm64 && docker && s3-browser'");
    const helper = blockOf(codeOf(real), /^def nodeSh\(String cmd\)\s*\{/m);
    expect(helper).toMatch(/--memory 3g\b/);
    expect(helper).toMatch(/\bnode:22\b/);
  });

  it("orders the Quality steps npm ci, typecheck, lint, test:coverage, crap, ratchet:check, audit:prod, ci/trivy.sh, build, sbom", () => {
    expect(QUALITY_ORDER.map(([name]) => name)).toEqual([
      "npm ci", "typecheck", "lint", "test:coverage", "crap", "ratchet:check",
      "audit:prod", "ci/trivy.sh", "build", "sbom",
    ]);
    expect(laneProblems(real).filter((p) => p.startsWith("Quality"))).toEqual([]);
  });

  it.each(Object.entries(FIXTURES))("is red for %s", (_name, fixture) => {
    expect(laneProblems(fixture).length).toBeGreaterThan(0);
  });

  it("names the broken property in each red fixture", () => {
    const [concurrency, memory, order] = Object.values(FIXTURES).map((f) => laneProblems(f).join("; "));
    expect(concurrency).toContain("options lack disableConcurrentBuilds");
    expect(memory).toContain("--memory");
    expect(order).toMatch(/Quality runs [\w:/.]+ before lint/);
  });

  it("is red for a copy that lacks each of the six options", () => {
    for (const option of [
      /^\s*ansiColor\('xterm'\)\n/m,
      /^\s*timestamps\(\)\n/m,
      /^\s*buildDiscarder\([^\n]*\n/m,
      /^\s*copyArtifactPermission\([^\n]*\n/m,
      /^\s*timeout\(time: 200[^\n]*\n/m,
    ]) {
      expect(laneProblems(without(option, "")).length).toBeGreaterThan(0);
    }
  });

  it("is red for a copy with the wrong label, no reset or no stage timeout", () => {
    expect(laneProblems(without("label 'arm64 && docker && s3-browser'", "label 'linux'")).join()).toContain("Quality label");
    expect(laneProblems(without("        sh 'git clean -ffdxq'\n        // ratchet", "        echo skip\n        // ratchet")).join()).toContain("git clean");
    expect(laneProblems(without("options { timeout(time: 30, unit: 'MINUTES') }", "")).join()).toContain("stage timeout");
  });
});

describe("the Jenkinsfile posts the jenkins/gate commit status (repocheck)", () => {
  it("has no gate problem", () => {
    expect(gateProblems(real)).toEqual([]);
  });

  it("posts the context jenkins/gate with the states pending, success and failure", () => {
    const code = codeOf(real);
    expect(code).toMatch(/\\+"context\\+":\\+"jenkins\/gate\\+"/);
    expect(code).toContain("postGate('pending',");
    expect(code).toContain("finishGate('success',");
    expect(code).toContain("finishGate('failure',");
  });

  it("posts failure from post { unsuccessful }, which covers FAILURE and ABORTED, and success only from post { success }", () => {
    const post = blockOf(blockOf(codeOf(real), /^pipeline\s*\{/m), /^ {2}post\s*\{/m);
    expect(blockOf(post, /\bunsuccessful\s*\{/)).toContain("finishGate('failure'");
    expect(blockOf(post, /\bsuccess\s*\{/)).toContain("finishGate('success'");
    expect(post).not.toMatch(/\b(failure|cleanup)\s*\{/);
    // The reports of post { always } run on every outcome and never decide the gate.
    expect(blockOf(post, /\balways\s*\{/)).not.toContain("Gate(");
  });

  it("names the failed stage in the failure description", () => {
    expect(codeOf(real)).toMatch(/finishGate\('failure',[^\n]*\$\{env\.GATE_STAGE/);
    expect(codeOf(real)).toContain("gateStage('Quality')");
  });

  it("uses the token only inside withCredentials on github-n-orlov", () => {
    const code = codeOf(real);
    const body = blockOf(code, /\bwithCredentials\(\[[^\n]*\]\)\s*\{/);
    expect(body).toContain("GH_TOKEN");
    expect(body.length).toBeGreaterThan(0);
    expect(code.replace(body, "").replace("passwordVariable: 'GH_TOKEN'", "")).not.toContain("GH_TOKEN");
    expect(code).toContain("credentialsId: 'github-n-orlov'");
  });

  it("posts on the first parent when the PR build is a merge commit", () => {
    const sha = blockOf(codeOf(real), /^def gateSha\(\)\s*\{/m);
    expect(sha).toContain("HEAD^2");
    expect(sha).toContain("git rev-parse HEAD^1");
  });

  it.each(Object.entries(GATE_FIXTURES))("is red for %s", (_name, fixture) => {
    expect(gateProblems(fixture).length).toBeGreaterThan(0);
  });

  it("names the broken property in each red gate fixture", () => {
    const [ctx, failure, token] = Object.values(GATE_FIXTURES).map((f) => gateProblems(f).join("; "));
    expect(ctx).toContain("jenkins/gate");
    expect(failure).toContain("failure status");
    expect(token).toContain("outside withCredentials");
  });
});

describe("the Jenkinsfile runs the e2e suite as three parallel shards (repocheck)", () => {
  it("has no e2e problem", () => {
    expect(e2eProblems(real)).toEqual([]);
  });

  it("runs three shards scripts/e2e-docker.sh --shard=<i>/3 on arm64 && docker && s3-browser", () => {
    const code = codeOf(real);
    const parallel = blockOf(blockOf(blockOf(blockOf(code, /^pipeline\s*\{/m), /\bstages\s*\{/), /\bstage\('E2E'\)\s*\{/), /\bparallel\s*\{/);
    expect([...parallel.matchAll(/\bstage\('E2E shard (\d)\/3'\)/g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
    expect([...parallel.matchAll(/\be2eShard\(\d\)/g)]).toHaveLength(3);
    expect(blockOf(code, /^def e2eShard\(int index\)\s*\{/m)).toContain('node("arm64 && docker && s3-browser${exclude}")');
    expect(code).toContain('scripts/e2e-docker.sh --shard=${index}/3');
  });

  it("wraps the shard body in lock(resource: \"s3b-e2e-${env.NODE_NAME}\")", () => {
    const body = blockOf(codeOf(real), /^def e2eShard\(int index\)\s*\{/m);
    expect(blockOf(body, /\block\(resource: "s3b-e2e-\$\{env\.NODE_NAME\}", skipIfLocked: true\)\s*\{/)).toContain("e2e-docker.sh");
  });

  it("removes the shard's s3b- containers and volumes in post { aborted } and post { cleanup }", () => {
    const code = codeOf(real);
    const parallel = blockOf(blockOf(blockOf(blockOf(code, /^pipeline\s*\{/m), /\bstages\s*\{/), /\bstage\('E2E'\)\s*\{/), /\bparallel\s*\{/);
    expect([...parallel.matchAll(/\be2eShardCleanup\(\d\)/g)]).toHaveLength(6);
    const cleanup = blockOf(code, /^def e2eShardCleanup\(int index\)\s*\{/m);
    expect(cleanup).toContain("docker rm -fv");
    expect(cleanup).toContain("docker volume rm");
    expect(cleanup).toContain("s3b-.*-${tag}");
  });

  it.each(Object.entries(E2E_FIXTURES))("is red for %s", (_name, fixture) => {
    expect(e2eProblems(fixture).length).toBeGreaterThan(0);
  });

  it("names the broken property in each red e2e fixture", () => {
    const [lock, cleanup, count, label] = Object.values(E2E_FIXTURES).map((f) => e2eProblems(f).join("; "));
    expect(lock).toContain("lock(resource:");
    expect(cleanup).toContain("post { aborted }");
    expect(cleanup).toContain("post { cleanup }");
    expect(count).toContain("2 shards, expected 3");
    expect(label).toContain("label is linux");
  });
});

describe("the Jenkinsfile runs the release dry run on the amd64 agent (repocheck)", () => {
  it("has no release dry-run problem", () => {
    expect(releaseProblems(real)).toEqual([]);
  });

  it("runs on amd64 && docker && s3-browser, on master always and elsewhere when a packaging path changed", () => {
    const stage = blockOf(blockOf(blockOf(codeOf(real), /^pipeline\s*\{/m), /\bstages\s*\{/), /\bstage\('Release dry-run'\)\s*\{/);
    expect(blockOf(stage, /\bagent\s*\{/)).toContain("label 'amd64 && docker && s3-browser'");
    const anyOf = blockOf(blockOf(stage, /\bwhen\s*\{/), /\banyOf\s*\{/);
    expect(anyOf).toContain("branch 'master'");
    expect(anyOf).toContain("env.PACKAGING_CHANGED == 'true'");
  });

  it("builds electron-builder --linux AppImage --x64 -p never and then runs scripts/smoke-appimage.sh", () => {
    const stage = blockOf(blockOf(blockOf(codeOf(real), /^pipeline\s*\{/m), /\bstages\s*\{/), /\bstage\('Release dry-run'\)\s*\{/);
    const steps = blockOf(stage, /\bsteps\s*\{/);
    expect(steps).toContain("npx electron-builder --linux AppImage --x64 -p never");
    expect(steps.indexOf("scripts/smoke-appimage.sh")).toBeGreaterThan(steps.indexOf("electron-builder"));
  });

  it("lists ci.yml's packaging paths with the release definition files in place of release.yml", () => {
    const ci = readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "ci.yml"), "utf8");
    const block = /RELEASE_PATHS: \|\n((?: {12}\S.*\n)+)/.exec(ci)?.[1] ?? "";
    const ciPaths = block.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(ciPaths.length).toBeGreaterThan(0);
    const expected = ciPaths.filter((p) => p !== ".github/workflows/release.yml");
    for (const p of expected) expect(RELEASE_PATHS).toContain(p);
    expect(RELEASE_PATHS).toEqual(expect.arrayContaining(["Jenkinsfile.release", "ci/release-build.sh", "ci/release-stage.sh"]));
    const listed = [...blockOf(codeOf(real), /^def releasePaths\(\)\s*\{/m).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(listed).toEqual(RELEASE_PATHS);
  });

  it.each(Object.entries(RELEASE_FIXTURES))("is red for %s", (_name, fixture) => {
    expect(releaseProblems(fixture).length).toBeGreaterThan(0);
  });

  it("names the broken property in each red release fixture", () => {
    const [x64, master, smoke, label, paths] = Object.values(RELEASE_FIXTURES).map((f) => releaseProblems(f).join("; "));
    expect(x64).toContain("--x64");
    expect(master).toContain("branch 'master'");
    expect(smoke).toContain("scripts/smoke-appimage.sh");
    expect(label).toContain("label is arm64");
    expect(paths).toContain("lacks package.json");
  });
});

describe("the Jenkinsfile publishes the reports in post { always } (repocheck)", () => {
  it("has no report problem", () => {
    expect(reportProblems(real)).toEqual([]);
  });

  it("records unit and e2e JUnit and builds one Allure report from the unit and all three shards' results", () => {
    const always = blockOf(blockOf(blockOf(codeOf(real), /^pipeline\s*\{/m), /^ {2}post\s*\{/m), /\balways\s*\{/);
    expect(always).toContain("junit/junit.xml");
    expect(always).toContain("e2e-*/junit/e2e-junit.xml");
    expect(always).toContain("allure@3.20.1 generate");
    expect(always).toContain("--config scripts/allurerc.mjs");
    expect(always).toContain("cp previous/allure-history/history.jsonl allure-report/history.jsonl");
  });

  it("archives coverage, the ESLint JSON, the SBOM, the Trivy report and the Playwright report", () => {
    const archive = /archiveArtifacts artifacts: '([^']*)'/.exec(codeOf(real))?.[1].split(/,\s*/);
    expect(archive).toEqual(expect.arrayContaining(["coverage/**", "reports/eslint.json", "sbom/**", "reports/trivy.txt", "e2e-*/playwright-report/**"]));
  });

  it.each(Object.entries(REPORT_FIXTURES))("is red for %s", (_name, fixture) => {
    expect(reportProblems(fixture).length).toBeGreaterThan(0);
  });

  it("names the broken property in each red report fixture", () => {
    const [junit, history, publish, summaryPublish, summaryRender, playwright, eslint] = Object.values(REPORT_FIXTURES).map((f) => reportProblems(f).join("; "));
    expect(summaryPublish).toContain("does not publish the CI summary page");
    expect(summaryRender).toContain("does not render the CI summary page");
    expect(junit).toContain("does not record the unit JUnit");
    expect(junit).toContain("junit sits outside post { always }");
    expect(history).toContain("copyArtifacts");
    expect(publish).toContain("publishHTML");
    expect(playwright).toContain("does not archive playwright-report/");
    expect(eslint).toContain("does not archive reports/eslint.json");
  });
});
