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
    expect(post).not.toMatch(/\b(failure|always|cleanup)\s*\{/);
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
