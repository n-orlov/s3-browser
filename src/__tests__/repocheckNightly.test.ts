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
  "Jenkinsfile.noUnstash (badge never fed the stash)": without(",\n                              'mutation-results': '.']", "]"),
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
