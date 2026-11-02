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
    expect(laneProblems(without("arm64 && docker && s3-browser", "linux")).join()).toContain("Quality label");
    expect(laneProblems(without("sh 'git clean -ffdxq'", "echo skip")).join()).toContain("git clean");
    expect(laneProblems(without("options { timeout(time: 30, unit: 'MINUTES') }", "")).join()).toContain("stage timeout");
  });
});
