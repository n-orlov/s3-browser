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
// Used for the unnamed case ("the GitHub Actions workflow remains ...") and to stop a deletion word elsewhere in the
// sentence from excusing a claim; a NAMED workflow is checked whatever verb the sentence uses (retainedWorkflowClaims).
const RETENTION = /\b(stays?|remains?|retain(s|ed)?|preserved?|kept|keeps?|continues?|still (exists?|runs?|present|in place|there|used|scheduled|active)|until (the |all )?(\w+ )?workflows? (are|is) (retired|deleted|removed))\b/i;
// A sentence that says a workflow left. It exempts a sentence only when the sentence makes no retention claim too.
const LEAVING = /\b(deleted|retired|removed|gone|no longer|replaced|moved|migrated|superseded|formerly|previously|never from)\b/i;

/** Workflow titles a sentence refers to: "GitHub `X` workflow", "the `X` workflow", "GitHub Actions X workflow", "workflow `X`". */
function titlesIn(sentence: string): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(/`([^`]+)`\s+(?:GitHub\s+)?(?:Actions\s+)?workflow\b/gi)) out.push(m[1]);
  for (const m of sentence.matchAll(/\b(?:GitHub|Actions)\s+(?!Actions\b|workflows?\b)([A-Za-z0-9][\w-]*(?:\s+[A-Z0-9][\w-]*)*)\s+workflow\b/g)) out.push(m[1]);
  for (const m of sentence.matchAll(/\bworkflow\s+`([^`]+)`/gi)) out.push(m[1]);
  return out.map((t) => t.trim().toLowerCase()).filter((t) => !/^\.?github\/|\.ya?ml$/.test(t));
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
 * text of `.github/workflows/`) or, for a `*.yml` named outside that directory, not in `otherFiles`.
 */
function retainedWorkflowClaims(section: string, workflows: Record<string, string>, otherFiles: Set<string>): string[] {
  const have = workflowNames(workflows);
  const problems: string[] = [];
  for (const sentence of sentencesOf(section)) {
    const retained = RETENTION.test(sentence);
    const leaving = LEAVING.test(sentence) && !retained;
    const named = [...sentence.matchAll(/[A-Za-z0-9][\w.-]*\.ya?ml\b/g)].map((m) => m[0]);
    if (!leaving) {
      for (const file of named) {
        if (!have.has(file.toLowerCase()) && !otherFiles.has(file.toLowerCase())) problems.push(`names ${file}, which does not exist: ${sentence.slice(0, 80)}`);
      }
    }
    // A workflow named by its title must be one the tree has, unless the sentence only says it left: "the GitHub
    // `Mutation` workflow is retained / runs weekly / stays ..." is rejected whatever the verb.
    if (!leaving) {
      for (const t of titlesIn(sentence)) if (!have.has(t)) problems.push(`names workflow ${t}, which does not exist: ${sentence.slice(0, 80)}`);
    }
    // A retained workflow with no name at all cannot be checked against the tree, so it is rejected outright.
    if (retained && named.length === 0 && titlesIn(sentence).length === 0 && /\b(GitHub|Actions)\b[^.`]{0,20}\bworkflows?\b/i.test(sentence)) {
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
    ["a retired workflow said to be retired", "The GitHub `Mutation` workflow was retired; the Jenkins `Mutation` stage replaces it."],
  ])("is accepted: %s", (_label, sentence) => {
    expect(retainedWorkflowClaims(`Intro.\n\n${sentence}\n`, WORKFLOWS, new Set(["dependabot.yml"]))).toEqual([]);
  });
});
