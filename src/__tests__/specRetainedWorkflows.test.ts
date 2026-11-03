// SPEC sections 4 and 5 describe the Jenkins topology as it is: no passage may claim that a GitHub workflow is
// retained (still present, kept, "stays until ...") when that workflow is not in the tree. The retired workflows'
// names are assembled from parts so that this file does not itself contain the file names it forbids.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const RETIRED = ["ci", "e2e-soak", "mutation", "release"];
const retiredFile = (stem: string): string => [stem, "yml"].join(".");

/** Sections 4 and 5 of the spec: from the `## 4.` heading up to the end of section 5. */
function sectionsFourAndFive(spec: string): string {
  const start = spec.search(/^## 4\. /m);
  if (start < 0) return "";
  const rest = spec.slice(start + 1);
  const afterFive = rest.search(/^## (?!4\.|5\.)/m);
  return afterFive < 0 ? spec.slice(start) : spec.slice(start, start + 1 + afterFive);
}

const sentencesOf = (text: string): string[] =>
  text.split(/\n|(?<=[.;:])\s+(?=[A-Z`*])/).map((s) => s.trim()).filter(Boolean);

// A sentence that says a workflow is still around ("still" alone is too common: "the README still links ...").
// Used only for the unnamed case ("the GitHub Actions workflow remains ..."): a NAMED workflow is checked whatever
// verb the sentence uses (retainedWorkflowClaims).
const RETENTION = /\b(stays?|remains?|retain(s|ed)?|preserved?|kept|keeps?|continues?|still (exists?|runs?|present|in place|there|used|scheduled|active)|until (the |all )?(\w+ )?workflows? (are|is) (retired|deleted|removed))\b/i;

// A mention of a workflow the tree does not have is excused only when the leaving statement is about THAT mention:
// a leaving word directly before it ("moved from the GitHub `X` workflow", "the retired `X` workflow", "previously
// ran in the `X` workflow") or a leaving predicate directly after it ("`X` workflow was retired", "`a.yml` and
// `b.yml` were deleted"). A leaving word elsewhere in the sentence ("... alongside the migrated Jenkins checks")
// says nothing about the named workflow and excuses nothing.
const FILLER_BEFORE = String.raw`(?:(?:ran|run|lived|was|were|in|on|by|of|the|a|an|its|their|GitHub|Actions|old|former|workflows?|files?)\s+|[\`(,]\s*|[\w.-]+\.ya?ml\b\s*)*`;
const LEFT_BEFORE = new RegExp(String.raw`\b(?:(?:moved|moves|moving|migrated|migrates|migrating|ported|porting|shifted|transferred|taken|split|cut over|removed|dropped|deleted|retired)(?:\s+(?:over|out|away|off))?\s+(?:from|out of)|formerly|previously|former|retired|deleted|removed|dropped|replaced|replaces|replacing|supersedes|superseded|superseding|instead of|in place of)\s+${FILLER_BEFORE}$`, "i");
const LEFT_AFTER = /^(?:[\s`(),]|\band\b|\bor\b|[\w.-]+\.ya?ml\b|`[^`]+`|\b(?:files?|workflows?|GitHub|Actions)\b)*(?:(?:was|were|is|are|has|have|had|been|now|since|then|later|all|both|each|fully|also)\s+)*(?:deleted|retired|removed|gone|replaced|superseded|migrated|moved|ported|dropped|no longer exists?)\b/i;

/** A mention of a workflow (by title or file name) at [start, end) of its sentence. */
interface Mention { name: string; start: number; end: number }

/** Workflow titles a sentence refers to: "GitHub `X` workflow", "the `X` workflow", "GitHub Actions X workflow", "workflow `X`". */
function titleMentions(sentence: string): Mention[] {
  const out: Mention[] = [];
  const add = (m: RegExpMatchArray): void => { out.push({ name: m[1].trim().toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }); };
  for (const m of sentence.matchAll(/`([^`]+)`\s+(?:GitHub\s+)?(?:Actions\s+)?workflow\b/gi)) add(m);
  for (const m of sentence.matchAll(/\b(?:GitHub|Actions)\s+(?!Actions\b|workflows?\b)([A-Za-z0-9][\w-]*(?:\s+[A-Z0-9][\w-]*)*)\s+workflow\b/g)) add(m);
  for (const m of sentence.matchAll(/\bworkflow\s+`([^`]+)`/gi)) add(m);
  return out.filter((t) => !/^\.?github\/|\.ya?ml$/.test(t.name));
}

/** `*.yml` / `*.yaml` file names a sentence mentions. */
function fileMentions(sentence: string): Mention[] {
  return [...sentence.matchAll(/[A-Za-z0-9][\w.-]*\.ya?ml\b/g)].map((m) => ({ name: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

// A source relationship ("reports come from the `X` workflow", "derived from", "fetched from") is not a departure: a
// bare "from" excuses nothing, only a departing verb with it ("moved from", "migrated from") does. And a mention that
// is said to still exist right after it ("`X` workflow, which still runs") is a retention claim whatever else the
// sentence says about it.
const PERSISTS_AFTER = /^[\s`)]*,?\s*(?:(?:which|that|and|but|it|they)\s+)*(?:(?:is|are)\s+)?(?:still\b|remains?\b|stays?\b|continues?\b|(?:retained|kept|preserved)\b)/i;

/** True when the sentence says that this mention's workflow left, in words attached to the mention itself. */
function saysItLeft(sentence: string, m: Mention): boolean {
  if (PERSISTS_AFTER.test(sentence.slice(m.end))) return false;
  return LEFT_BEFORE.test(sentence.slice(0, m.start)) || LEFT_AFTER.test(sentence.slice(m.end));
}

/** The workflow names a tree provides: each file's name and stem, plus its `name:` line. */
function workflowNames(files: Record<string, string>): Set<string> {
  const names = new Set<string>();
  for (const [file, text] of Object.entries(files)) {
    names.add(file.toLowerCase());
    names.add(file.replace(/\.ya?ml$/, "").toLowerCase());
    const n = /^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(text)?.[1];
    if (n) names.add(n.toLowerCase());
  }
  return names;
}

/**
 * One problem per claim in `section` that a workflow is retained although it is not in `workflows` (file name ->
 * text of `.github/workflows/`) or, for a `*.yml` named outside that directory, not in `otherFiles`. Any mention of
 * an absent workflow counts as such a claim ("the GitHub `Mutation` workflow is retained / runs weekly / stays ..."),
 * whatever the verb, unless the mention itself is said to have left (saysItLeft).
 */
function retainedWorkflowClaims(section: string, workflows: Record<string, string>, otherFiles: Set<string>): string[] {
  const have = workflowNames(workflows);
  const problems: string[] = [];
  for (const sentence of sentencesOf(section)) {
    const files = fileMentions(sentence);
    const titles = titleMentions(sentence);
    for (const m of files) {
      if (!have.has(m.name) && !otherFiles.has(m.name) && !saysItLeft(sentence, m)) problems.push(`names ${m.name}, which does not exist: ${sentence.slice(0, 80)}`);
    }
    for (const m of titles) {
      if (!have.has(m.name) && !saysItLeft(sentence, m)) problems.push(`names workflow ${m.name}, which does not exist: ${sentence.slice(0, 80)}`);
    }
    // A retained workflow with no name at all cannot be checked against the tree, so it is rejected outright.
    if (RETENTION.test(sentence) && files.length === 0 && titles.length === 0 && /\b(GitHub|Actions)\b[^.`]{0,20}\bworkflows?\b/i.test(sentence)) {
      problems.push(`claims a retained workflow without naming it: ${sentence.slice(0, 80)}`);
    }
  }
  return problems;
}

function treeOtherFiles(): Set<string> {
  const out = new Set<string>();
  for (const dir of [".", ".github"]) for (const e of readdirSync(path.join(root, dir))) out.add(e.toLowerCase());
  return out;
}

function treeWorkflows(): Record<string, string> {
  const dir = path.join(root, ".github/workflows");
  const files: Record<string, string> = {};
  for (const f of existsSync(dir) ? readdirSync(dir) : []) files[f] = readFileSync(path.join(dir, f), "utf8");
  return files;
}

const WORKFLOWS = { "codeql.yml": "name: CodeQL\n", "macos-build.yml": "name: macos-build\n" };
const NONE = new Set<string>();

describe("SPEC sections 4 and 5 against the workflows in the tree", () => {
  it("make no retained-workflow claim the tree contradicts", () => {
    const spec = readFileSync(path.join(root, "SPEC.md"), "utf8");
    const section = sectionsFourAndFive(spec);
    expect(section.length).toBeGreaterThan(1000);
    expect(retainedWorkflowClaims(section, treeWorkflows(), treeOtherFiles())).toEqual([]);
  });

  it("has none of the retired workflow files in the tree", () => {
    for (const stem of RETIRED) expect(existsSync(path.join(root, ".github/workflows", retiredFile(stem))), stem).toBe(false);
  });

  // Red fixtures: the finding's own passage and further cases of the same rule.
  it.each([
    ["the finding's passage: the GitHub Mutation workflow stays until the workflows are retired", "The GitHub `Mutation` workflow below stays until the workflows are retired."],
    ["a retired file named as still running", `\`${retiredFile("release")}\` still runs the nightly soak.`],
    ["a retired file named as a kept gate", `The merge gate is \`${retiredFile("ci")}\`, which is kept for the pull request.`],
    ["a retained workflow that no file provides, without a name", "The GitHub Actions workflow remains in place beside the Jenkinsfile."],
    ["a retained workflow with a different title", "The GitHub `Soak` workflow still exists and repeats the e2e suite."],
    // The review's probe, and further phrasings of the same rule that no fixed list of retention verbs would hold.
    ["the review's probe: is retained", "The GitHub `Mutation` workflow is retained for scheduled mutation testing."],
    ["a retired workflow said to run, with no retention verb", "Mutation testing runs weekly in the GitHub `Mutation` workflow."],
    ["a retired workflow said to be preserved, without the word GitHub", "The `E2E soak` workflow is preserved for the nightly repeat."],
    ["a retired workflow said to continue", "The GitHub Actions Release workflow continues to publish tagged builds."],
    ["a retired workflow by `workflow X`", "Scheduled mutation testing belongs to workflow `Mutation` on GitHub."],
    ["a retained claim beside a deletion statement", "The soak workflow file was deleted, but the GitHub `Mutation` workflow is retained."],
    ["a retired file said to be preserved", `\`${retiredFile("mutation")}\` is preserved for scheduled mutation testing.`],
    // The verifier's probe: a leaving word elsewhere in the sentence ("migrated") is about something else, and further
    // cases of the same rule where a leaving word sits in the sentence but is not attached to the named workflow.
    ["the verifier's probe: a leaving word about other checks", "The GitHub `Mutation` workflow runs every Monday alongside the migrated Jenkins checks."],
    ["a leaving word after the claim, about another stage", `\`${retiredFile("mutation")}\` runs weekly next to the replaced lint stage.`],
    ["a leaving verb before the mention, about other checks", "Nightly checks moved to Jenkins and the GitHub `E2E soak` workflow repeats the suite."],
    ["a leaving adjective on another job", "The retired Trivy job aside, the GitHub `Release` workflow publishes tagged builds."],
    ["a deleted file beside a retained one", `The deleted \`${retiredFile("ci")}\` aside, \`${retiredFile("release")}\` still publishes tags.`],
    // The second review's probe: a source relationship ("from") is not a departure; "still runs" is a retention claim.
    ["the second probe: reports come from the workflow, which still runs", "Mutation reports come from the GitHub `Mutation` workflow, which still runs every Monday."],
    ["a source relationship with a retired file", `The release notes are generated from \`${retiredFile("release")}\` every tag.`],
    ["data fetched from a retired workflow", "Coverage is fetched from the GitHub `E2E soak` workflow artifacts."],
    ["derived from a retired workflow, which stays", "The schedule is derived from the GitHub `Mutation` workflow, which stays in place."],
    ["a departing verb contradicted by a persistence clause", "Mutation testing moved from the GitHub `Mutation` workflow, which still runs every Monday."],
    ["a past-tense aside that does not say the workflow left", "The `Mutation` workflow, previously weekly, now runs nightly."],
  ])("is rejected: %s", (_label, sentence) => {
    expect(retainedWorkflowClaims(`Intro.\n\n${sentence}\n`, WORKFLOWS, NONE)).not.toEqual([]);
  });

  // Green fixtures: claims about workflows that are present, and statements that a workflow was deleted.
  it.each([
    ["an existing workflow is kept", "The `codeql.yml` workflow stays on GitHub-hosted runners."],
    ["an existing workflow by title", "The GitHub `CodeQL` workflow remains a separate analysis."],
    ["a deletion statement naming the retired files", `The four workflow files (\`${retiredFile("ci")}\`, \`${retiredFile("mutation")}\`) were deleted.`],
    ["a non-workflow yml", "Dependabot's `dependabot.yml` stays at weekly."],
    ["a present workflow running, by title", "The `macos-build` workflow is dispatched by the Jenkins release job."],
    ["a retired workflow said to have moved", "Mutation testing moved from the GitHub `Mutation` workflow to the Jenkins nightly lane."],
    ["a retired workflow migrated away from", "Mutation testing was migrated from the GitHub `Mutation` workflow to the Jenkins nightly lane."],
    ["a retired workflow said to be moved out of", `Mutation testing moved out of \`${retiredFile("mutation")}\` and into the Jenkins nightly lane.`],
    ["a retired workflow said to be retired", "The GitHub `Mutation` workflow was retired; the Jenkins `Mutation` stage replaces it."],
    ["a retired workflow said to have run there previously", "Mutation testing previously ran in the GitHub `Mutation` workflow and now runs in the Jenkins nightly lane."],
    ["a list of retired files said to be deleted", `The \`${retiredFile("ci")}\`, \`${retiredFile("e2e-soak")}\` and \`${retiredFile("release")}\` files were deleted when Jenkins took over.`],
    ["a retired workflow replaced by a Jenkins stage", "The Jenkins `Mutation` stage replaces the retired GitHub `Mutation` workflow."],
  ])("is accepted: %s", (_label, sentence) => {
    expect(retainedWorkflowClaims(`Intro.\n\n${sentence}\n`, WORKFLOWS, new Set(["dependabot.yml"]))).toEqual([]);
  });
});
