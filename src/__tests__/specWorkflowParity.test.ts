import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

type Workflow = { on?: { pull_request?: { types?: string[] } } };

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), "utf8");
const workflow = (name: string): Workflow =>
  parse(read(`.github/workflows/${name}`)) as Workflow;

/** SPEC section 5 (CI topology) up to the next level-2 heading or the end of the file. */
function sectionFive(spec: string): string {
  const start = spec.search(/^## 5\. /m);
  if (start < 0) return "";
  const rest = spec.slice(start + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? spec.slice(start) : spec.slice(start, start + 1 + next);
}

/** The bullet of section 5 that starts with the given bold label, or "" when absent. */
function bullet(section: string, label: string): string {
  const lines = section.split("\n");
  const i = lines.findIndex((l) => l.startsWith(`- **${label}`));
  return i < 0 ? "" : lines[i];
}

const WORKFLOWS: { file: string; triggerLabel: string; draftLabel: string }[] =
  [
    {
      file: "ci.yml",
      triggerLabel: "Triggers.",
      draftLabel: "Draft pull requests.",
    },
    { file: "codeql.yml", triggerLabel: "CodeQL (", draftLabel: "CodeQL (" },
    {
      file: "mutation.yml",
      triggerLabel: "Mutation (",
      draftLabel: "Mutation (",
    },
  ];

/** One problem string per drift between SPEC section 5 and the workflow's pull_request types and draft rule. */
function typeProblems(spec: string, file: string, types: string[]): string[] {
  const section = sectionFive(spec);
  const entry = WORKFLOWS.find((w) => w.file === file);
  if (!entry) return [`${file}: not a known workflow`];
  const problems: string[] = [];
  const triggers = bullet(section, entry.triggerLabel);
  if (!triggers)
    problems.push(`${file}: no section 5 bullet "${entry.triggerLabel}"`);
  const listed = (/types: \[([^\]]*)\]/.exec(triggers)?.[1] ?? "")
    .split(",")
    .map((t) => t.trim());
  for (const t of types) {
    if (!listed.includes(t))
      problems.push(`${file}: bullet does not name pull_request type ${t}`);
  }
  const draft = bullet(section, entry.draftLabel);
  if (!/\bdraft\b/.test(draft))
    problems.push(`${file}: bullet does not state the draft rule`);
  return problems;
}

/** One problem string per way SPEC section 5 mishandles the master branch: merges not stated, or main still named. */
function branchProblems(spec: string): string[] {
  const section = sectionFive(spec);
  const problems: string[] = [];
  const merges = bullet(section, "Pushes to `master` are merges.");
  if (!/push to `master` is the squash merge of a pull request/.test(merges)) {
    problems.push(
      "section 5 does not state that a push to `master` is a merge",
    );
  }
  if (/\bmain\b/.test(section)) problems.push("section 5 still names `main`");
  if (/`?master`?\s+or\s+`?main`?/.test(section))
    problems.push("section 5 still says `master` or `main`");
  return problems;
}

function releaseProblems(spec: string): string[] {
  const release = bullet(sectionFive(spec), "Release.");
  const problems: string[] = [];
  if (!release) problems.push("no Release bullet in section 5");
  if (!release.includes("git merge-base --is-ancestor"))
    problems.push("Release bullet does not name the ancestor gate");
  if (!release.includes("verify-on-master"))
    problems.push("Release bullet does not name the verify-on-master job");
  return problems;
}

describe("SPEC section 5 matches the live workflow triggers", () => {
  const spec = read("SPEC.md");

  for (const w of WORKFLOWS) {
    it(`${w.file}: bullet names every pull_request type and the draft rule`, () => {
      const types = workflow(w.file).on?.pull_request?.types ?? [];
      expect(types.length).toBeGreaterThan(0);
      expect(typeProblems(spec, w.file, types)).toEqual([]);
    });
  }

  it("states that pushes to master are merges and names no main branch", () => {
    expect(branchProblems(spec)).toEqual([]);
  });

  it("the Release bullet names the ancestor gate of release.yml", () => {
    expect(releaseProblems(spec)).toEqual([]);
    expect(read(".github/workflows/release.yml")).toContain(
      "merge-base --is-ancestor",
    );
  });
});

describe("negative fixtures", () => {
  const spec = read("SPEC.md");
  const types = ["opened", "synchronize", "reopened", "ready_for_review"];

  it("fails when a types value is absent from the SPEC bullet", () => {
    const broken = spec.replace(
      /(`types: \[opened, synchronize, reopened, )ready_for_review(\]`, filtered by `paths`)/,
      "$1$2",
    );
    expect(broken).not.toBe(spec);
    expect(typeProblems(broken, "mutation.yml", types)).toContain(
      "mutation.yml: bullet does not name pull_request type ready_for_review",
    );
  });

  it("fails when the draft rule is missing from the CI draft bullet", () => {
    const broken = spec.replace(
      /^- \*\*Draft pull requests\.\*\*.*$/m,
      "- **Draft pull requests.** Nothing.",
    );
    expect(typeProblems(broken, "ci.yml", types)).toContain(
      "ci.yml: bullet does not state the draft rule",
    );
  });

  it("fails when a SPEC fixture still says `master` or `main`", () => {
    const broken = spec.replace(
      "`pull_request` targeting `master` with",
      "`pull_request` targeting `master` or `main` with",
    );
    expect(broken).not.toBe(spec);
    expect(branchProblems(broken)).toContain(
      "section 5 still says `master` or `main`",
    );
  });

  it("fails when the merge statement is gone", () => {
    const broken = spec.replace(
      /^- \*\*Pushes to `master` are merges\.\*\*.*$/m,
      "",
    );
    expect(branchProblems(broken)).toContain(
      "section 5 does not state that a push to `master` is a merge",
    );
  });

  it("fails when the Release bullet loses the ancestor gate", () => {
    const broken = spec.replace(/git merge-base --is-ancestor/g, "git log");
    expect(releaseProblems(broken)).toContain(
      "Release bullet does not name the ancestor gate",
    );
  });
});
