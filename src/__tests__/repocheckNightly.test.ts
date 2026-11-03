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

const real = readFileSync(path.join(__dirname, "..", "..", "Jenkinsfile"), "utf8");
const spec = readFileSync(path.join(__dirname, "..", "..", "SPEC.md"), "utf8");

/** The real Jenkinsfile with one property removed; throws if the edit did not apply. */
function without(from: string | RegExp, to: string): string {
  const out = real.replace(from, to);
  if (out === real) throw new Error(`fixture edit ${String(from)} did not apply`);
  return out;
}

/** One problem string per property of the weekly Mutation stage the Jenkinsfile lacks. */
function mutationProblems(jenkinsfile: string): string[] {
  const problems: string[] = [];
  const code = codeOf(jenkinsfile);
  const pipeline = blockOf(code, /^pipeline\s*\{/m);
  const stage = blockOf(blockOf(pipeline, /\bstages\s*\{/), /\bstage\('Mutation'\)\s*\{/);
  if (!stage) return ["no Mutation stage"];

  const label = /\blabel\s+'([^']*)'/.exec(blockOf(stage, /\bagent\s*\{/))?.[1];
  if (label !== "arm64 && docker && s3-browser") problems.push(`Mutation label is ${label ?? "unset"}, expected arm64 && docker && s3-browser`);
  if (!/\btimeout\(time: \d+, unit: 'MINUTES'\)/.test(blockOf(stage, /\boptions\s*\{/))) problems.push("Mutation has no stage timeout");

  const when = blockOf(stage, /\bwhen\s*\{/);
  if (!/\bbeforeAgent true\b/.test(when)) problems.push("Mutation does not decide before taking an agent (beforeAgent true)");
  const allOf = blockOf(when, /\ballOf\s*\{/);
  if (!/expression\s*\{\s*isNightly\(\)\s*\}/.test(allOf)) problems.push("Mutation is not limited to the nightly lane (isNightly())");
  const anyOf = blockOf(allOf, /\banyOf\s*\{/);
  if (!/expression\s*\{\s*env\.BUILD_DAY == '1'\s*\}/.test(anyOf)) problems.push("Mutation does not run on Mondays (BUILD_DAY == '1')");
  if (!/expression\s*\{\s*params\.EXTENDED == true\s*\}/.test(anyOf)) problems.push("Mutation does not run when EXTENDED is true");
  if (/^\s*(?:branch|expression)\b[^\n]*\|\|/m.test(when)) problems.push("Mutation guard uses || instead of allOf/anyOf");

  const steps = blockOf(stage, /\bsteps\s*\{/);
  if (!/\bnodeSh\('npm run mutation'\)/.test(steps)) problems.push("Mutation does not run npm run mutation through nodeSh (memory-capped container)");
  if (!/\bgateStage\('Mutation'\)/.test(steps)) problems.push("Mutation does not call gateStage first");

  const always = blockOf(blockOf(stage, /\bpost\s*\{/), /\balways\s*\{/);
  if (!/publishHTML\(\[reportName: 'Mutation', reportDir: 'reports\/mutation', reportFiles: 'mutation\.html'/.test(always)) {
    problems.push("Mutation does not publish reports/mutation/mutation.html as an HTML report");
  }
  if (!/stash name: 'mutation-results'[^\n]*includes: 'reports\/mutation\/\*\*'/.test(always)) problems.push("Mutation does not stash reports/mutation for the badge");

  // The badge: declared, fed by the stash in the pipeline's post { always }, set from the score.
  const post = blockOf(pipeline, /^ {2}post\s*\{/m);
  const postAlways = blockOf(post, /\balways\s*\{/);
  if (!/'mutation-results': '\.'/.test(postAlways)) problems.push("post { always } does not unstash mutation-results into the workspace");
  if (!/mutation: addEmbeddableBadgeConfiguration\(id: 'mutation'/.test(postAlways)) problems.push("post { always } does not declare the mutation badge");
  if (!/badges:ci/.test(postAlways) || !/\.setStatus\(/.test(postAlways) || !/\.setColor\(/.test(postAlways)) {
    problems.push("post { always } does not set the mutation badge status and colour from the score (badges:ci)");
  }

  // The weekday the guard reads is recorded in Quality.
  const quality = blockOf(blockOf(pipeline, /\bstages\s*\{/), /\bstage\('Quality'\)\s*\{/);
  if (!/env\.BUILD_DAY = sh\(returnStdout: true, script: 'date -u \+%u'\)/.test(quality)) problems.push("Quality does not record the UTC build day (BUILD_DAY)");
  return problems;
}

const MUTATION_FIXTURES: Record<string, string> = {
  "Jenkinsfile.noNightlyGuard (without isNightly())": without(/ {10}expression \{ isNightly\(\) \}\n/, ""),
  "Jenkinsfile.noMondayGuard (without the Monday expression)": without(/ {12}expression \{ env\.BUILD_DAY == '1' \}\n/, ""),
  "Jenkinsfile.noExtendedGuard (without the EXTENDED expression)": without(/ {12}expression \{ params\.EXTENDED == true \}\n/, ""),
  "Jenkinsfile.noHtmlPublish (without publishHTML)": without(/ {10}publishHTML\(\[reportName: 'Mutation'[^\n]*\n[^\n]*\n/, ""),
  "Jenkinsfile.noStash (without the stash for the badge)": without(/ {10}stash name: 'mutation-results'[^\n]*\n/, ""),
  "Jenkinsfile.noUnstash (badge never fed the stash)": without("'mutation-results': '.',", ""),
  "Jenkinsfile.noBadgeSet (badge declared but never set)": without(/ {16}badges\[line\.substring\(0, eq\)\]\.setStatus[^\n]*\n {16}badges\[line\.substring\(0, eq\)\]\.setColor[^\n]*\n/, ""),
  "Jenkinsfile.noMemoryCap (npm run mutation outside nodeSh)": without("nodeSh('npm run mutation')", "sh 'npm run mutation'"),
  "Jenkinsfile.wrongLabel (Mutation on amd64)": without(/(stage\('Mutation'\)[\s\S]*?agent \{ label ')arm64( && docker && s3-browser' \})/, "$1amd64$2"),
  "Jenkinsfile.noBuildDay (Quality never records the weekday)": without(/ {8}script \{ env\.BUILD_DAY = [^\n]*\n/, ""),
};

describe("the Jenkinsfile's weekly Mutation stage (repocheck)", () => {
  it("has no problem", () => {
    expect(mutationProblems(real)).toEqual([]);
  });

  it("runs after the Release dry-run stage, never before Quality", () => {
    const code = codeOf(real);
    const order = ["Quality", "E2E", "Release dry-run", "Mutation"].map((n) => code.indexOf(`stage('${n}')`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it.each(Object.entries(MUTATION_FIXTURES))("is red for %s", (_name, fixture) => {
    expect(mutationProblems(fixture).length).toBeGreaterThan(0);
  });

  it("names the broken property in the nightly, Monday, EXTENDED, HTML publish and badge fixtures", () => {
    const [nightly, monday, extended, html, stash, unstash, badge, memory, label, day] = Object.values(MUTATION_FIXTURES).map((f) => mutationProblems(f).join("; "));
    expect(nightly).toContain("nightly lane");
    expect(monday).toContain("Mondays");
    expect(extended).toContain("EXTENDED");
    expect(html).toContain("HTML report");
    expect(stash).toContain("stash reports/mutation");
    expect(unstash).toContain("unstash mutation-results");
    expect(badge).toContain("badge status and colour");
    expect(memory).toContain("memory-capped");
    expect(label).toContain("label is amd64");
    expect(day).toContain("BUILD_DAY");
  });
});

describe("SPEC.md section 5 describes the Mutation stage", () => {
  const section = spec.slice(spec.indexOf("## 5. CI topology"));
  const paragraph = section.split("\n").find((l) => l.startsWith("- **Stage `Mutation`")) ?? "";

  it("has a Stage `Mutation` paragraph", () => {
    expect(paragraph).not.toBe("");
  });

  it.each(["npm run mutation", "arm64 && docker && s3-browser", "isNightly()", "Monday", "EXTENDED", "publishHTML", "reports/mutation", "`mutation` badge", "--memory 3g"])(
    "mentions %s",
    (needle) => {
      expect(paragraph).toContain(needle);
    },
  );
});

/** The first stage named `name` inside `stages`, whatever its nesting depth. */
function stageOf(code: string, name: string): string {
  return blockOf(code, new RegExp(`\\bstage\\('${name}'\\)\\s*\\{`));
}

const NIGHTLY_LABEL = "arm64 && docker && s3-browser";

/** One problem string per property of the nightly lane (cron, EXTENDED, Soak, Stability, Trivy fresh DB, guards) the Jenkinsfile lacks. */
function nightlyProblems(jenkinsfile: string): string[] {
  const problems: string[] = [];
  const code = codeOf(jenkinsfile);
  const pipeline = blockOf(code, /^pipeline\s*\{/m);

  // The trigger: a cron on master only, an empty spec everywhere else.
  const cron = /\bcron\(([^\n]*)\)\s*$/m.exec(blockOf(pipeline, /\btriggers\s*\{/))?.[1] ?? "";
  if (!cron) problems.push("no cron trigger");
  else if (!/^env\.BRANCH_NAME == 'master' \? '[^']+' : ''$/.test(cron)) problems.push(`the cron is not master-only (cron(${cron}))`);

  // The on-demand switch.
  if (!/\bbooleanParam\(name: 'EXTENDED', defaultValue: false\b/.test(blockOf(pipeline, /\bparameters\s*\{/))) problems.push("no boolean EXTENDED parameter (default false)");

  // One question for the whole lane: the cron cause, or EXTENDED.
  const isNightly = blockOf(code, /^def isNightly\(\)\s*\{/m);
  if (!/TimerTrigger\$TimerTriggerCause/.test(isNightly) || !/params\.EXTENDED == true/.test(isNightly)) problems.push("isNightly() is not the cron cause or EXTENDED");

  const stages = blockOf(pipeline, /\bstages\s*\{/);
  // Every extended stage is guarded by the nightly condition and runs on arm64 phones only.
  for (const name of ["Soak", "Stability", "Trivy fresh DB", "Mutation"]) {
    const stage = stageOf(stages, name);
    if (!stage) {
      problems.push(`no ${name} stage`);
      continue;
    }
    if (!/expression\s*\{\s*isNightly\(\)\s*\}/.test(blockOf(stage, /\bwhen\s*\{/))) problems.push(`${name} is not guarded by the nightly condition (isNightly())`);
    if (name !== "Soak") {
      const label = /\blabel\s+'([^']*)'/.exec(blockOf(stage, /\bagent\s*\{/))?.[1];
      if (label !== NIGHTLY_LABEL) problems.push(`${name} label is ${label ?? "unset"}, expected ${NIGHTLY_LABEL}`);
    }
  }

  // Soak: three parallel shards, each one soakShard(i) with its own timeout.
  const soak = stageOf(stages, "Soak");
  const shards = [...blockOf(soak, /\bparallel\s*\{/).matchAll(/\bstage\('Soak shard (\d)\/3'\)\s*\{/g)].map((m) => m[1]);
  if (shards.join() !== "1,2,3") problems.push(`Soak runs shards ${shards.join() || "none"}, expected 1,2,3`);
  for (const i of [1, 2, 3]) {
    const shard = blockOf(soak, new RegExp(`\\bstage\\('Soak shard ${i}/3'\\)\\s*\\{`));
    if (!new RegExp(`\\bsoakShard\\(${i}\\)`).test(shard)) problems.push(`Soak shard ${i} does not call soakShard(${i})`);
    if (!/\btimeout\(time: \d+, unit: 'MINUTES'\)/.test(blockOf(shard, /\boptions\s*\{/))) problems.push(`Soak shard ${i} has no stage timeout`);
    if (!new RegExp(`\\be2eShardCleanup\\(${i}\\)`).test(blockOf(shard, /\bpost\s*\{/))) problems.push(`Soak shard ${i} does not clean up its containers in post`);
  }
  const body = blockOf(code, /^def soakShard\(int index\)\s*\{/m);
  if (!body) problems.push("no soakShard helper");
  const nodeLabel = /\bnode\("([^"$]*)\$\{exclude\}"\)/.exec(body)?.[1];
  if (nodeLabel !== NIGHTLY_LABEL) problems.push(`the soak shard node label is ${nodeLabel ?? "unset"}, expected ${NIGHTLY_LABEL}`);
  const locked = blockOf(body, /\block\(resource: "s3b-e2e-\$\{env\.NODE_NAME\}"(, skipIfLocked: true)?\)\s*\{/);
  if (!locked) problems.push("the soak shard is not inside the per-node lock");
  if (!/scripts\/e2e-docker\.sh --repeat-each=3 --shard=\$\{index\}\/3/.test(locked)) problems.push("the soak does not run e2e-docker.sh with --repeat-each=3 on its shard");
  if (!/\bgateStage\('Soak'\)/.test(body)) problems.push("the soak shard does not name its stage for the gate");
  if (!/\bfinally\s*\{[^}]*stash name: "soak-results-\$\{index\}"[^}]*test-results\/results\.json/.test(locked)) problems.push("the soak shard does not stash its JSON report and JUnit in a finally");

  // Stability: three clean-state unit runs, the marker over the three JSON reports, a red stage when a run failed.
  const stability = stageOf(stages, "Stability");
  const steps = blockOf(stability, /\bsteps\s*\{/);
  const loop = blockOf(steps, /\bfor \(int run = 1; run <= 3; run\+\+\)\s*\{/);
  if (!loop) problems.push("Stability does not loop over three runs");
  if (!/\bsh 'git clean -ffdxq/.test(loop) || !/\bnodeSh\('npm ci/.test(loop)) problems.push("a Stability run does not start from a clean state (git clean, npm ci)");
  if (!/\bnpx vitest run\b/.test(loop)) problems.push("a Stability run does not run the unit suite");
  if (!/ci\/mark-flaky\.mjs[^\n]*run-1\.json[^\n]*run-2\.json[^\n]*run-3\.json/.test(steps)) problems.push("Stability does not run the flaky marker over its three JSON reports");
  if (!/\bfileExists\('stability-out\/failed'\)[\s\S]*\berror\b/.test(steps)) problems.push("Stability does not fail when a run failed");
  if (!/\bgateStage\('Stability'\)/.test(steps)) problems.push("Stability does not call gateStage first");

  // Trivy with a freshly downloaded database.
  const trivy = blockOf(stageOf(stages, "Trivy fresh DB"), /\bsteps\s*\{/);
  if (!/ci\/trivy\.sh --fresh\b/.test(trivy)) problems.push("Trivy fresh DB does not run ci/trivy.sh --fresh");
  if (!/\bgateStage\('Trivy fresh DB'\)/.test(trivy)) problems.push("Trivy fresh DB does not call gateStage first");

  // The reports: the stashes come back in post { always } and the counts add up into the flaky count.
  const postAlways = blockOf(blockOf(pipeline, /^ {2}post\s*\{/m), /\balways\s*\{/);
  for (const name of ["stability-results", "trivy-fresh-results", "soak-results-1", "soak-results-2", "soak-results-3"]) {
    if (!postAlways.includes(`'${name}'`)) problems.push(`post { always } does not unstash ${name}`);
  }
  if (!/ci\/mark-flaky\.mjs\$\{soakJunit\} --count-file reports\/flaky-count-soak\.txt\$\{soakReports\}/.test(postAlways) || !/soak-\$\{shard\}\/test-results\/results\.json/.test(postAlways)) {
    problems.push("post { always } does not run the flaky marker over the three soak shards' JSON reports at once");
  }
  if (!/flaky-count-stability\.txt/.test(postAlways) || !/flaky-count-soak\.txt/.test(postAlways) || !/writeFile file: 'reports\/flaky-count\.txt'/.test(postAlways)) {
    problems.push("post { always } does not add the Stability and soak flaky counts into reports/flaky-count.txt");
  }
  return problems;
}

const NIGHTLY_FIXTURES: Record<string, string> = {
  "Jenkinsfile.cronEverywhere (cron on every branch)": without("cron(env.BRANCH_NAME == 'master' ? '17 2 * * *' : '')", "cron('17 2 * * *')"),
  "Jenkinsfile.cronNotMaster (cron on the non-master branches)": without("env.BRANCH_NAME == 'master' ? '17 2 * * *' : ''", "env.BRANCH_NAME != 'master' ? '17 2 * * *' : ''"),
  "Jenkinsfile.noCron (no trigger)": without(/ {2}triggers \{[^}]*\}\n/, ""),
  "Jenkinsfile.noExtendedParam (no EXTENDED parameter)": without("booleanParam(name: 'EXTENDED'", "booleanParam(name: 'WIDE'"),
  "Jenkinsfile.soakUnguarded (Soak without the nightly guard)": without("stage('Soak') {\n      when { expression { isNightly() } }\n", "stage('Soak') {\n"),
  "Jenkinsfile.stabilityUnguarded (Stability without the nightly guard)": without(/(stage\('Stability'\) \{\n {6}when \{\n {8}beforeAgent true\n) {8}expression \{ isNightly\(\) \}\n/, "$1"),
  "Jenkinsfile.trivyUnguarded (Trivy fresh DB without the nightly guard)": without(/(stage\('Trivy fresh DB'\) \{\n {6}when \{\n {8}beforeAgent true\n) {8}expression \{ isNightly\(\) \}\n/, "$1"),
  "Jenkinsfile.mutationUnguarded (Mutation without the nightly guard)": without(/ {10}expression \{ isNightly\(\) \}\n/, ""),
  "Jenkinsfile.soakRepeat2 (soak repeats twice)": without("e2e-docker.sh --repeat-each=3", "e2e-docker.sh --repeat-each=2"),
  "Jenkinsfile.soakNoLock (soak outside the per-node lock)": without(/(def soakShard[\s\S]*?)lock\(resource: "s3b-e2e-\$\{env\.NODE_NAME\}", skipIfLocked: true\)/, "$1timeout(time: 60, unit: 'MINUTES')"),
  "Jenkinsfile.soakNoMarker (soak reports never reach the flaky marker)": without("node ci/mark-flaky.mjs${soakJunit}", "node ci/other.mjs${soakJunit}"),
  "Jenkinsfile.soakAmd64 (soak shard on amd64)": without(/(def soakShard[\s\S]*?node\("arm64)( && docker)/, "$1_x$2").replace("arm64_x", "amd64"),
  "Jenkinsfile.stabilityTwoRuns (two stability runs)": without("run <= 3; run++", "run <= 2; run++"),
  "Jenkinsfile.stabilityNotClean (stability runs without git clean)": without("sh 'git clean -ffdxq -e stability-out'\n", ""),
  "Jenkinsfile.stabilityNoMarker (stability never marks flaky tests)": without(/ci\/mark-flaky\.mjs --junit reports\/stability-junit\.xml/, "true --junit reports/stability-junit.xml"),
  "Jenkinsfile.stabilityAmd64 (stability on amd64)": without(/(stage\('Stability'\)[\s\S]*?agent \{ label ')arm64/, "$1amd64"),
  "Jenkinsfile.trivyCached (Trivy without --fresh)": without("ci/trivy.sh --fresh'\n      }\n      post", "ci/trivy.sh'\n      }\n      post"),
  "Jenkinsfile.noFlakySum (flaky counts never added up)": without("writeFile file: 'reports/flaky-count.txt'", "echo 'reports/flaky-count.txt'"),
};

describe("the Jenkinsfile's nightly lane (repocheck)", () => {
  it("has no problem", () => {
    expect(nightlyProblems(real)).toEqual([]);
  });

  it("lists Soak, Stability and Trivy fresh DB after the Release dry-run stage and before Mutation", () => {
    const code = codeOf(real);
    const order = ["Release dry-run", "Soak", "Stability", "Trivy fresh DB", "Mutation"].map((n) => code.indexOf(`stage('${n}')`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it.each(Object.entries(NIGHTLY_FIXTURES))("is red for %s", (_name, fixture) => {
    expect(nightlyProblems(fixture).length).toBeGreaterThan(0);
  });

  it("names the broken property in the cron, EXTENDED and guard fixtures", () => {
    const f = Object.fromEntries(Object.entries(NIGHTLY_FIXTURES).map(([k, v]) => [k.split(" ")[0], nightlyProblems(v).join("; ")]));
    expect(f["Jenkinsfile.cronEverywhere"]).toContain("not master-only");
    expect(f["Jenkinsfile.cronNotMaster"]).toContain("not master-only");
    expect(f["Jenkinsfile.noCron"]).toContain("no cron trigger");
    expect(f["Jenkinsfile.noExtendedParam"]).toContain("EXTENDED parameter");
    expect(f["Jenkinsfile.soakUnguarded"]).toContain("Soak is not guarded by the nightly condition");
    expect(f["Jenkinsfile.stabilityUnguarded"]).toContain("Stability is not guarded by the nightly condition");
    expect(f["Jenkinsfile.trivyUnguarded"]).toContain("Trivy fresh DB is not guarded by the nightly condition");
    expect(f["Jenkinsfile.mutationUnguarded"]).toContain("Mutation is not guarded by the nightly condition");
    expect(f["Jenkinsfile.soakRepeat2"]).toContain("--repeat-each=3");
    expect(f["Jenkinsfile.soakNoLock"]).toContain("per-node lock");
    expect(f["Jenkinsfile.soakNoMarker"]).toContain("flaky marker over the three soak shards");
    expect(f["Jenkinsfile.stabilityTwoRuns"]).toContain("three runs");
    expect(f["Jenkinsfile.stabilityNotClean"]).toContain("clean state");
    expect(f["Jenkinsfile.trivyCached"]).toContain("--fresh");
  });
});

describe("SPEC.md section 5 describes the nightly lane", () => {
  const section = spec.slice(spec.indexOf("## 5. CI topology"));
  const paragraphOf = (start: string) => section.split("\n").find((l) => l.startsWith(start)) ?? "";

  it.each([
    ["- **Nightly lane (triggers)", ["triggers { cron(env.BRANCH_NAME == 'master'", "`EXTENDED`", "isNightly()", "arm64 && docker && s3-browser", "`Soak`", "`Stability`", "`Trivy fresh DB`", "`Mutation`"]],
    ["- **Stage `Soak`", ["--repeat-each=3", "--shard=<i>/3", "s3b-e2e-", "ci/mark-flaky.mjs", "flaky-count-soak.txt", "retries: 0"]],
    ["- **Stage `Stability`", ["three", "git clean -ffdxq", "npm ci", "npx vitest run", "ci/mark-flaky.mjs", "flaky-count-stability.txt"]],
    ["- **Stage `Trivy fresh DB`", ["ci/trivy.sh --fresh", "HIGH,CRITICAL", "cached vulnerability DB"]],
    ["- **Nightly reports", ["reports/flaky-count.txt", "not measured"]],
  ])("has the paragraph %s", (start, needles) => {
    const paragraph = paragraphOf(start);
    expect(paragraph).not.toBe("");
    for (const needle of needles) expect(paragraph).toContain(needle);
  });
});
