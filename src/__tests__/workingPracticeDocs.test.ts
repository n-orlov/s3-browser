import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const claudeMd = readFileSync(path.join(root, "CLAUDE.md"), "utf8");
const jenkinsfile = readFileSync(path.join(root, "Jenkinsfile"), "utf8");

/** The text of the `## Working practice` section, up to the next level-2 heading; undefined when there is none. */
function workingPracticeSection(markdown: string): string | undefined {
  const match = /^## Working practice[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown);
  return match?.[1];
}

/** The commit status context the Jenkinsfile posts (`"context":"..."` in its statuses API call); undefined when there is none. */
function gateContext(jenkinsfileText: string): string | undefined {
  return /\\*"context\\*"\s*:\s*\\*"([^"\\]+)\\*"/.exec(jenkinsfileText)?.[1];
}

/** The multibranch build of the merged master sha that the Working practice names as the post-merge check. */
const POST_MERGE_CHECK = "s3-browser/ci/master";

/** One problem per way CLAUDE.md fails to document the working practice for the commit status `context`. */
function workingPracticeProblems(markdown: string, context: string | undefined): string[] {
  if (!context) return ["the Jenkinsfile posts no commit status context"];
  const section = workingPracticeSection(markdown);
  if (section === undefined) return ["CLAUDE.md has no `## Working practice` section"];
  const problems: string[] = [];
  if (!section.includes(`\`${context}\``)) problems.push(`the Working practice section does not name the required check \`${context}\` exactly`);
  if (!section.includes(`\`${POST_MERGE_CHECK}\``)) problems.push(`the Working practice section does not name \`${POST_MERGE_CHECK}\` as the post-merge check`);
  if (/workflow_dispatch/.test(section)) problems.push("the Working practice section prescribes a workflow_dispatch for the final check");
  const topics: [string, RegExp][] = [
    ["a branch per scope", /branch/i],
    ["opening the PR only when the scope is complete", /only when the scope is complete/i],
    ["draft until then", /\bdraft\b/i],
    ["squash merge", /squash/i],
    ["nothing landing on master after the final check", /nothing lands on `master` after/i],
    ["releases cut from s3-browser/release", /`s3-browser\/release`/],
  ];
  for (const [topic, pattern] of topics) {
    if (!pattern.test(section)) problems.push(`the Working practice section does not cover ${topic}`);
  }
  return problems;
}

/** The `--max-warnings` value in the lint script of a package.json text; undefined when there is none. */
function lintMaxWarnings(packageJson: string): number | undefined {
  const lint = (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts?.lint;
  const match = /--max-warnings\s+(\d+)/.exec(lint ?? "");
  return match ? Number(match[1]) : undefined;
}

/** One problem per `--max-warnings N` in the markdown that differs from `expected`; one when there is none at all. */
function maxWarningsProblems(markdown: string, expected: number | undefined): string[] {
  if (expected === undefined) return ["package.json's lint script has no --max-warnings"];
  const stated = [...markdown.matchAll(/--max-warnings\s+(\d+)/g)].map((m) => Number(m[1]));
  if (stated.length === 0) return ["CLAUDE.md does not state the lint --max-warnings value"];
  return stated.filter((n) => n !== expected).map((n) => `CLAUDE.md states --max-warnings ${n} but package.json's lint script uses ${expected}`);
}

const packageJson = readFileSync(path.join(root, "package.json"), "utf8");
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const context = gateContext(jenkinsfile);

describe("CLAUDE.md Working practice section", () => {
  it("names the status context the Jenkinsfile posts and covers the whole practice", () => {
    expect(context).toBe("jenkins/gate");
    expect(workingPracticeProblems(claudeMd, context)).toEqual([]);
  });

  it("reads the context from the Jenkinsfile, so a renamed context is a problem while CLAUDE.md has the old one", () => {
    const renamed = jenkinsfile.replace(/jenkins\/gate/g, "jenkins/verdict");
    expect(gateContext(renamed)).toBe("jenkins/verdict");
    const problems = workingPracticeProblems(claudeMd, gateContext(renamed));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("jenkins/verdict");
  });

  it("reports a problem for a fixture CLAUDE.md that names `gate` instead of the context", () => {
    const old = claudeMd.replace(/`jenkins\/gate`/g, "`gate`");
    const problems = workingPracticeProblems(old, context);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("`jenkins/gate`");
  });

  it("reports a problem when the post-merge check is not named", () => {
    const without = claudeMd.replace(/`s3-browser\/ci\/master`/g, "the master build");
    expect(workingPracticeProblems(without, context)).toEqual([`the Working practice section does not name \`${POST_MERGE_CHECK}\` as the post-merge check`]);
  });

  it("reports a problem for a fixture that prescribes a workflow_dispatch as the final check", () => {
    const dispatching = claudeMd.replace(/wait for the `s3-browser\/ci\/master` Jenkins build/, "run `gh workflow run ci.yml --ref master` (`workflow_dispatch`) and wait for `s3-browser/ci/master`");
    expect(dispatching).not.toBe(claudeMd);
    expect(workingPracticeProblems(dispatching, context)).toEqual(["the Working practice section prescribes a workflow_dispatch for the final check"]);
  });

  it("reports a problem when the section is missing", () => {
    const without = claudeMd.replace("## Working practice", "## Something else");
    expect(workingPracticeProblems(without, context)).toEqual(["CLAUDE.md has no `## Working practice` section"]);
  });

  it("reports that the Jenkinsfile posts no context when it has none", () => {
    expect(workingPracticeProblems(claudeMd, gateContext("pipeline {}"))).toEqual(["the Jenkinsfile posts no commit status context"]);
  });

  it("does not accept the context appearing outside the section", () => {
    const moved = claudeMd.replace(/^## Working practice[\s\S]*?(?=^## )/m, "## Working practice\n\nBranch, draft, squash.\n\n") + `\n\`${context}\`\n`;
    expect(workingPracticeProblems(moved, context).some((p) => p.includes("does not name the required check"))).toBe(true);
  });

  it("reports a problem for each practice the section leaves out", () => {
    const thin = "## Working practice\n\nUse branches.\n";
    expect(workingPracticeProblems(thin, context).length).toBeGreaterThanOrEqual(5);
  });
});

describe("CLAUDE.md lint ratchet statement", () => {
  it("states the --max-warnings value of package.json's lint script, which is 0", () => {
    expect(lintMaxWarnings(packageJson)).toBe(0);
    expect(maxWarningsProblems(claudeMd, lintMaxWarnings(packageJson))).toEqual([]);
  });

  it("reports a fixture that still says 18 as a problem", () => {
    const stale = claudeMd.replace("--max-warnings 0", "--max-warnings 18");
    expect(maxWarningsProblems(stale, lintMaxWarnings(packageJson))).toEqual(["CLAUDE.md states --max-warnings 18 but package.json's lint script uses 0"]);
  });

  it("reports a problem when CLAUDE.md states no value", () => {
    expect(maxWarningsProblems("no lint line", 0)).toHaveLength(1);
  });
});

describe("README Contributing section", () => {
  it("points at the Working practice section of CLAUDE.md", () => {
    const contributing = /^## Contributing[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readme)?.[1] ?? "";
    expect(contributing).toMatch(/\]\(CLAUDE\.md#working-practice\)/);
  });
});
