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

// A sentence that says a workflow is still around: "stays", "remains", "is kept", "still exists/runs", "until ... retired".
const RETENTION = /\b(stays?|remains?|is kept|are kept|kept until|still (exists?|runs?|present|in place|there)|until (the |all )?(\w+ )?workflows? (are|is) (retired|deleted|removed))\b/i;
const LEAVING = /\b(deleted|retired|removed|gone|no longer|replaced|never from)\b/i;

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
    if (retained && /\b(GitHub|Actions)\b[^.`]{0,20}\bworkflows?\b|\bGitHub\s+`[^`]+`\s+workflow\b/i.test(sentence)) {
      // "the GitHub `Mutation` workflow stays ...": the name in backticks (or the word) before "workflow" must be one the tree has.
      const titled = [...sentence.matchAll(/(?:GitHub|Actions)\s+`?([A-Za-z0-9][\w -]*?)`?\s+workflow\b/g)].map((m) => m[1].toLowerCase());
      const claimsUnnamed = titled.length === 0 && named.length === 0;
      if (claimsUnnamed || titled.some((t) => !have.has(t))) problems.push(`claims a retained workflow that is absent: ${sentence.slice(0, 80)}`);
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
  ])("is rejected: %s", (_label, sentence) => {
    expect(retainedWorkflowClaims(`Intro.\n\n${sentence}\n`, WORKFLOWS, NONE)).not.toEqual([]);
  });

  // Green fixtures: claims about workflows that are present, and statements that a workflow was deleted.
  it.each([
    ["an existing workflow is kept", "The `codeql.yml` workflow stays on GitHub-hosted runners."],
    ["an existing workflow by title", "The GitHub `CodeQL` workflow remains a separate analysis."],
    ["a deletion statement naming the retired files", `The four workflow files (\`${retiredFile("ci")}\`, \`${retiredFile("mutation")}\`) were deleted.`],
    ["a non-workflow yml", "Dependabot's `dependabot.yml` stays at weekly."],
  ])("is accepted: %s", (_label, sentence) => {
    expect(retainedWorkflowClaims(`Intro.\n\n${sentence}\n`, WORKFLOWS, new Set(["dependabot.yml"]))).toEqual([]);
  });
});
