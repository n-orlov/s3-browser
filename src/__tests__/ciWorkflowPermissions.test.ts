import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

type Permissions = string | Record<string, string> | null | undefined;
interface Step {
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Job {
  if?: string | boolean;
  permissions?: Permissions;
  steps?: Step[];
}
interface Workflow {
  on?: unknown;
  permissions?: Permissions;
  jobs?: Record<string, Job>;
}

/** True when a `permissions:` value grants any write scope. */
function holdsWrite(permissions: Permissions): boolean {
  if (typeof permissions === "string") return permissions === "write-all";
  if (permissions === null || typeof permissions !== "object") return false;
  return Object.values(permissions).some((level) => level === "write");
}

/** Names of the events that trigger the workflow (`on:` may be a string, a list or a map). */
function triggers(workflow: Workflow): string[] {
  const on = workflow.on;
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on !== null && typeof on === "object") return Object.keys(on);
  return [];
}

const TOKEN =
  /\s*(github\.event_name\s*(?:==|!=)\s*'[^']*'|&&|\|\||\(|\)|!?[\w.-]+\(\)|[\w.-]+(?:\s*(?:==|!=)\s*(?:'[^']*'|[\w.-]+))?)/y;

/**
 * Evaluates a job `if:` expression for one event name. Any term that is not a comparison of
 * `github.event_name` is unknown and treated as true, so the answer is "can the job run for
 * this event". Expressions it cannot parse throw, which the caller reports as a violation.
 */
function canRunFor(condition: string | boolean | undefined, event: string) {
  if (condition === undefined || condition === true) return true;
  if (condition === false) return false;
  const source = condition.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1");
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < source.trimEnd().length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(source);
    if (!m) throw new Error(`cannot parse job condition: ${condition}`);
    tokens.push(m[1].replace(/\s+/g, " "));
    pos = TOKEN.lastIndex;
  }
  let i = 0;
  const atom = (): boolean => {
    const t = tokens[i++];
    if (t === "(") {
      const v = or();
      if (tokens[i++] !== ")") throw new Error(`unbalanced: ${condition}`);
      return v;
    }
    if (t === undefined || t === ")" || t === "&&" || t === "||") {
      throw new Error(`cannot parse job condition: ${condition}`);
    }
    const cmp = /^github\.event_name (==|!=) '([^']*)'$/.exec(t);
    if (!cmp) return true;
    return cmp[1] === "==" ? event === cmp[2] : event !== cmp[2];
  };
  const and = (): boolean => {
    let v = atom();
    while (tokens[i] === "&&") {
      i++;
      v = atom() && v;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (tokens[i] === "||") {
      i++;
      v = and() || v;
    }
    return v;
  };
  const result = or();
  if (i !== tokens.length) throw new Error(`trailing tokens: ${condition}`);
  return result;
}

/** One problem string per rule broken: top-level write, or a write job a pull request can reach. */
function permissionProblems(workflow: Workflow): string[] {
  const problems: string[] = [];
  if (holdsWrite(workflow.permissions)) {
    problems.push("top-level permissions grant a write scope");
  }
  const pullEvents = triggers(workflow).filter(
    (e) => e === "pull_request" || e === "pull_request_target",
  );
  for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
    if (!holdsWrite(job.permissions) || pullEvents.length === 0) continue;
    try {
      for (const event of pullEvents) {
        if (canRunFor(job.if, event)) {
          problems.push(
            `${name}: holds a write permission and is reachable from ${event}`,
          );
        }
      }
    } catch (e) {
      problems.push(`${name}: ${(e as Error).message}`);
    }
  }
  return problems;
}

/** A step that renders, copies or pushes badge files: its `run` mentions `badges` (the CLI, the directory or a path). */
const BADGE_STEP = /badges/;

/** Jobs holding a badge step that a pull_request event can reach (a badge push must be unreachable from one). */
function badgeReachabilityProblems(workflow: Workflow): string[] {
  const problems: string[] = [];
  const pullEvents = triggers(workflow).filter(
    (e) => e === "pull_request" || e === "pull_request_target",
  );
  for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
    if (!(job.steps ?? []).some((s) => BADGE_STEP.test(s.run ?? ""))) continue;
    try {
      for (const event of pullEvents) {
        if (canRunFor(job.if, event)) {
          problems.push(
            `${name}: writes or pushes badge files and is reachable from ${event}`,
          );
        }
      }
    } catch (e) {
      problems.push(`${name}: ${(e as Error).message}`);
    }
  }
  return problems;
}

/** What ci.yml's publish job must do for the badges: render them and restore the previous mutation badge. */
function publishBadgeProblems(workflow: Workflow): string[] {
  const steps = workflow.jobs?.publish?.steps;
  if (!steps) return ["ci.yml has no publish job"];
  const problems: string[] = [];
  if (!steps.some((s) => /\bnpm run\b[^\n]*\bbadges\b(?!:)/.test(s.run ?? ""))) {
    problems.push("publish has no step whose run invokes npm run badges");
  }
  if (
    !steps.some((s) =>
      /\bgit (?:show|checkout)\b[^\n]*:badges\/mutation\.json/.test(s.run ?? "") ||
      (/\bgit (?:show|checkout)\b/.test(s.run ?? "") &&
        /\bgh-pages\b/.test(s.run ?? "") &&
        /badges\/mutation\.json/.test(s.run ?? "")),
    )
  ) {
    problems.push(
      "publish has no step restoring badges/mutation.json from the previous gh-pages commit",
    );
  }
  return problems;
}

/**
 * The lint badge shows ESLint's own count, so `quality` must write `eslint --format json` to reports/eslint.json and
 * upload it as `eslint-result`, and `publish` must download that artifact into `reports/` for the renderer.
 */
function eslintResultProblems(workflow: Workflow): string[] {
  const problems: string[] = [];
  const quality = workflow.jobs?.quality?.steps ?? [];
  const publish = workflow.jobs?.publish?.steps ?? [];
  const isArtifact = (step: Step, action: string): boolean =>
    (step.uses ?? "").startsWith(`actions/${action}-artifact@`) && step.with?.name === "eslint-result";
  if (!quality.some((s) => /\beslint\b/.test(s.run ?? "") && /--format[ =]json/.test(s.run ?? "") && /reports\/eslint\.json/.test(s.run ?? ""))) {
    problems.push("quality has no step writing eslint --format json to reports/eslint.json");
  }
  if (!quality.some((s) => isArtifact(s, "upload") && s.with?.path === "reports/eslint.json")) {
    problems.push("quality does not upload reports/eslint.json as artifact eslint-result");
  }
  if (!publish.some((s) => isArtifact(s, "download") && s.with?.path === "reports")) {
    problems.push("publish does not download artifact eslint-result into reports/");
  }
  return problems;
}

const WORKFLOWS_DIR = path.resolve(__dirname, "../../.github/workflows");
const WORKFLOWS = readdirSync(WORKFLOWS_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();

describe("workflow listing", () => {
  it("covers every workflow file in .github/workflows, including ci, release and codeql", () => {
    expect(WORKFLOWS).toEqual(
      expect.arrayContaining(["ci.yml", "release.yml", "codeql.yml"]),
    );
  });
});

describe.each(WORKFLOWS)("%s workflow permissions", (file) => {
  it("grants no write permission at top level and keeps write jobs out of pull_request", () => {
    const workflow = parse(
      readFileSync(path.join(WORKFLOWS_DIR, file), "utf8"),
    ) as Workflow;
    expect(permissionProblems(workflow)).toEqual([]);
  });
});

describe.each(WORKFLOWS)("%s badge steps", (file) => {
  it("keeps every step that writes or pushes badge files in a job a pull_request cannot reach", () => {
    const workflow = parse(
      readFileSync(path.join(WORKFLOWS_DIR, file), "utf8"),
    ) as Workflow;
    expect(badgeReachabilityProblems(workflow)).toEqual([]);
  });
});

describe("ci.yml publish job badges", () => {
  const ciText = readFileSync(path.join(WORKFLOWS_DIR, "ci.yml"), "utf8");
  const ci = (): Workflow => parse(ciText) as Workflow;

  it("renders the badges with npm run badges and restores badges/mutation.json from the previous gh-pages commit", () => {
    expect(publishBadgeProblems(ci())).toEqual([]);
    expect(badgeReachabilityProblems(ci())).toEqual([]);
    expect(Object.keys(ci().jobs ?? {})).toContain("publish");
  });

  it("feeds the lint badge from an ESLint JSON result: quality writes and uploads it, publish downloads it", () => {
    expect(eslintResultProblems(ci())).toEqual([]);
    const text = ciText.slice(ciText.indexOf("  publish:"));
    expect(text).not.toMatch(/maxWarnings/);
  });

  it("flags a ci.yml copy without the ESLint JSON step, its upload or its download", () => {
    const noRun = ci();
    noRun.jobs!.quality.steps = noRun.jobs!.quality.steps!.filter((s) => !/--format json/.test(s.run ?? ""));
    expect(eslintResultProblems(noRun)).toEqual(["quality has no step writing eslint --format json to reports/eslint.json"]);
    const noUpload = ci();
    noUpload.jobs!.quality.steps = noUpload.jobs!.quality.steps!.filter((s) => s.with?.name !== "eslint-result");
    expect(eslintResultProblems(noUpload)).toEqual(["quality does not upload reports/eslint.json as artifact eslint-result"]);
    const noDownload = ci();
    noDownload.jobs!.publish.steps = noDownload.jobs!.publish.steps!.filter((s) => s.with?.name !== "eslint-result");
    expect(eslintResultProblems(noDownload)).toEqual(["publish does not download artifact eslint-result into reports/"]);
  });

  it("flags a ci.yml copy whose publish job lacks the badge step", () => {
    const wf = ci();
    wf.jobs!.publish.steps = wf.jobs!.publish.steps!.filter(
      (s) => !/npm run[^\n]*badges/.test(s.run ?? ""),
    );
    expect(publishBadgeProblems(wf)).toEqual([
      "publish has no step whose run invokes npm run badges",
    ]);
  });

  it("flags a ci.yml copy whose publish job lacks the restore step", () => {
    const wf = ci();
    wf.jobs!.publish.steps = wf.jobs!.publish.steps!.filter(
      (s) => !/git show/.test(s.run ?? ""),
    );
    expect(publishBadgeProblems(wf)).toEqual([
      "publish has no step restoring badges/mutation.json from the previous gh-pages commit",
    ]);
  });

  it("flags a restore that reads a different file than badges/mutation.json", () => {
    const wf = ci();
    for (const step of wf.jobs!.publish.steps!) {
      if (step.run) step.run = step.run.replaceAll("mutation.json", "other.json");
    }
    expect(publishBadgeProblems(wf)).toContain(
      "publish has no step restoring badges/mutation.json from the previous gh-pages commit",
    );
  });

  it("flags a badge push in a job a pull_request can reach", () => {
    const wf = ci();
    delete wf.jobs!.publish.if;
    expect(badgeReachabilityProblems(wf)).toEqual([
      "publish: writes or pushes badge files and is reachable from pull_request",
    ]);
    const other: Workflow = {
      on: ["push", "pull_request"],
      jobs: {
        badge: {
          if: "github.event_name != 'push'",
          steps: [{ run: "npm run badges -- --out b && git push origin gh-pages" }],
        },
      },
    };
    expect(badgeReachabilityProblems(other)).toHaveLength(1);
  });

  it("accepts a badge push in a push-only job", () => {
    const other: Workflow = {
      on: ["push", "pull_request"],
      jobs: {
        badge: {
          if: "github.event_name == 'push'",
          steps: [{ run: "git push origin gh-pages # badges/" }],
        },
      },
    };
    expect(badgeReachabilityProblems(other)).toEqual([]);
  });
});

describe("workflow permission validator", () => {
  it("flags a workflow with top-level contents: write", () => {
    const wf = parse(`
on: { push: {} }
permissions:
  contents: write
jobs:
  j: { runs-on: ubuntu-latest, steps: [] }
`) as Workflow;
    expect(permissionProblems(wf)).toEqual([
      "top-level permissions grant a write scope",
    ]);
  });

  it("flags a pull_request workflow whose write job has no event gate", () => {
    const wf = parse(`
on: { pull_request: {} }
permissions:
  contents: read
jobs:
  j:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps: []
`) as Workflow;
    expect(permissionProblems(wf)).toHaveLength(1);
  });

  it("flags a write job whose condition does not exclude pull_request", () => {
    const wf = (cond: string): Workflow => ({
      on: ["pull_request", "pull_request_target", "push"],
      jobs: { j: { if: cond, permissions: { contents: "write" } } },
    });
    expect(permissionProblems(wf("always()"))).toHaveLength(2);
    expect(
      permissionProblems(wf("github.event_name != 'pull_request'")),
    ).toHaveLength(1);
    expect(
      permissionProblems(
        wf(
          "github.event_name != 'pull_request' || github.ref == 'refs/heads/master'",
        ),
      ),
    ).toHaveLength(2);
    expect(permissionProblems(wf("github.event_name == 'push'"))).toEqual([]);
    expect(
      permissionProblems(
        wf("github.event_name == 'push' && github.ref == 'refs/heads/master'"),
      ),
    ).toEqual([]);
  });

  it("accepts a write job gated away from pull_request, and a write job in a push-only workflow", () => {
    const gated = parse(`
on: { push: {}, pull_request: {} }
jobs:
  j:
    if: github.event_name != 'pull_request'
    permissions: { contents: write }
`) as Workflow;
    expect(permissionProblems(gated)).toEqual([]);
    const pushOnly = parse(`
on: push
jobs:
  j:
    permissions: write-all
`) as Workflow;
    expect(permissionProblems(pushOnly)).toEqual([]);
  });

  it("reports a condition it cannot parse instead of passing it", () => {
    const wf: Workflow = {
      on: "pull_request",
      jobs: { j: { if: "github.event_name ==", permissions: "write-all" } },
    };
    expect(permissionProblems(wf)).toHaveLength(1);
  });
});
