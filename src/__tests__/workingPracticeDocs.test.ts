import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

type Workflow = { jobs?: Record<string, { name?: string }> };

const root = path.resolve(__dirname, "../..");
const claudeMd = readFileSync(path.join(root, "CLAUDE.md"), "utf8");
const ci = parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as Workflow;

/** The text of the `## Working practice` section, up to the next level-2 heading; undefined when there is none. */
function workingPracticeSection(markdown: string): string | undefined {
  const match = /^## Working practice[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown);
  return match?.[1];
}

/** One problem per way CLAUDE.md fails to document the working practice for the `gate` job named `gateName`. */
function workingPracticeProblems(markdown: string, gateName: string | undefined): string[] {
  if (!gateName) return ["ci.yml has no `gate` job with a `name:`"];
  const section = workingPracticeSection(markdown);
  if (section === undefined) return ["CLAUDE.md has no `## Working practice` section"];
  const problems: string[] = [];
  if (!section.includes(gateName)) problems.push(`the Working practice section does not name the required check \`${gateName}\` exactly`);
  const topics: [string, RegExp][] = [
    ["a branch per scope", /branch/i],
    ["opening the PR only when the scope is complete", /only when the scope is complete/i],
    ["draft until then", /\bdraft\b/i],
    ["squash merge", /squash/i],
    ["the final workflow_dispatch of ci.yml", /workflow_dispatch/],
    ["nothing landing on master after the final dispatch", /nothing lands on `master` after/i],
  ];
  for (const [topic, pattern] of topics) {
    if (!pattern.test(section)) problems.push(`the Working practice section does not cover ${topic}`);
  }
  return problems;
}

const gateName = ci.jobs?.gate?.name;

describe("CLAUDE.md Working practice section", () => {
  it("names the gate job's name from ci.yml and covers the whole practice", () => {
    expect(gateName).toBeTruthy();
    expect(workingPracticeProblems(claudeMd, gateName)).toEqual([]);
  });

  it("reports a problem when the gate job is renamed and CLAUDE.md still has the old name", () => {
    const problems = workingPracticeProblems(claudeMd, "gate (renamed)");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("gate (renamed)");
  });

  it("reports a problem when the section is missing", () => {
    const without = claudeMd.replace("## Working practice", "## Something else");
    expect(workingPracticeProblems(without, gateName)).toEqual(["CLAUDE.md has no `## Working practice` section"]);
  });

  it("does not accept the gate name appearing outside the section", () => {
    const moved = claudeMd.replace(/^## Working practice[\s\S]*?(?=^## )/m, "## Working practice\n\nBranch, draft, squash, workflow_dispatch.\n\n") + `\n${gateName}\n`;
    expect(workingPracticeProblems(moved, gateName).some((p) => p.includes("does not name the required check"))).toBe(true);
  });

  it("reports a problem for each practice the section leaves out", () => {
    const thin = "## Working practice\n\nUse branches.\n";
    expect(workingPracticeProblems(thin, gateName).length).toBeGreaterThanOrEqual(5);
  });
});
