import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

type Permissions = string | Record<string, string> | null | undefined;
interface Job {
  if?: string | boolean;
  permissions?: Permissions;
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
