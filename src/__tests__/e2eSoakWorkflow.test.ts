// .github/workflows/e2e-soak.yml (SPEC section 5): the full Playwright suite repeated with --repeat-each over 2 shards
// on the self-hosted runners, nightly and on demand, sharing ci.yml's concurrency group, with reports uploaded on every
// outcome; and playwright.config.ts keeps the settings a soak relies on (no retries, one worker, fixed timeouts).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
};
type Job = {
  "runs-on"?: unknown;
  steps?: Step[];
  strategy?: { matrix?: { shard?: number[] } };
  "timeout-minutes"?: number;
};
type Workflow = {
  on?: {
    schedule?: Array<{ cron: string }>;
    workflow_dispatch?: { inputs?: Record<string, { default?: unknown }> };
    [key: string]: unknown;
  };
  concurrency?: { group?: string };
  jobs?: Record<string, Job>;
};

const root = path.resolve(__dirname, "../..");
const soakText = readFileSync(
  path.join(root, ".github/workflows/e2e-soak.yml"),
  "utf8",
);
const ciText = readFileSync(
  path.join(root, ".github/workflows/ci.yml"),
  "utf8",
);
const configText = readFileSync(
  path.join(root, "playwright.config.ts"),
  "utf8",
);

const soakJob = (workflow: Workflow): Job =>
  Object.values(workflow.jobs ?? {})[0] ?? {};
const stepsOf = (workflow: Workflow): Step[] => soakJob(workflow).steps ?? [];

/** One message per way the nightly schedule is wrong; empty means a daily cron. */
function checkSchedule(workflow: Workflow): string[] {
  const schedule = workflow.on?.schedule;
  if (!schedule || schedule.length !== 1) return ["no single schedule entry"];
  // minute hour, then three wildcards = every day
  return /^\d+ \d+ \* \* \*$/.test(schedule[0].cron)
    ? []
    : [`cron ${schedule[0].cron} is not nightly`];
}

/** Reads a numeric `key: value` setting out of the config text (the `expect` timeout is nested, so it is matched by
 * its own indentation). Returns undefined when the key is missing. */
function configNumber(text: string, key: string): number | undefined {
  const match = new RegExp(`^\\s*${key}:\\s*(\\d+)\\b`, "m").exec(text);
  return match ? Number(match[1]) : undefined;
}

/** One message per way the config's soak-relevant settings differ from the required ones. */
function checkConfig(text: string): string[] {
  const problems: string[] = [];
  const wanted: Array<[string, number]> = [
    ["retries", 0],
    ["workers", 1],
    ["timeout", 60000],
  ];
  for (const [key, value] of wanted) {
    const actual = configNumber(text, key);
    if (actual !== value)
      problems.push(`${key} is ${String(actual)}, expected ${value}`);
  }
  const expectBlock = /expect:\s*\{([^}]*)\}/.exec(text);
  const expectTimeout = expectBlock
    ? configNumber(expectBlock[1], "timeout")
    : undefined;
  if (expectTimeout !== 10000)
    problems.push(`expect.timeout is ${String(expectTimeout)}, expected 10000`);
  return problems;
}

describe("e2e-soak.yml", () => {
  const workflow = parse(soakText) as Workflow;

  it("triggers only on a nightly schedule and workflow_dispatch", () => {
    expect(Object.keys(workflow.on ?? {}).sort()).toEqual([
      "schedule",
      "workflow_dispatch",
    ]);
    expect(checkSchedule(workflow)).toEqual([]);
  });

  it("fails the schedule check when the schedule is removed", () => {
    const removed: Workflow = {
      on: { workflow_dispatch: workflow.on?.workflow_dispatch },
    };
    expect(checkSchedule(removed)).toEqual(["no single schedule entry"]);
  });

  it("fails the schedule check when the cron is weekly", () => {
    const weekly: Workflow = { on: { schedule: [{ cron: "17 2 * * 1" }] } };
    expect(checkSchedule(weekly)).toEqual(["cron 17 2 * * 1 is not nightly"]);
  });

  it("has a dispatch input `repeat` that defaults to 3", () => {
    const input = workflow.on?.workflow_dispatch?.inputs?.repeat;
    expect(input).toBeDefined();
    expect(String(input?.default)).toBe("3");
  });

  it("runs on the s3-browser self-hosted runner", () => {
    expect(soakJob(workflow)["runs-on"]).toEqual([
      "self-hosted",
      "linux",
      "x64",
      "s3-browser",
    ]);
  });

  it("passes --repeat-each=<repeat> and the shard to scripts/e2e-docker.sh", () => {
    const run = stepsOf(workflow).find((s) =>
      s.run?.includes("scripts/e2e-docker.sh"),
    );
    expect(run).toBeDefined();
    expect(run?.run).toContain('--repeat-each="$REPEAT"');
    expect(run?.run).toContain("--shard=${{ matrix.shard }}/2");
    const env = (run as { env?: Record<string, string> }).env;
    expect(env?.REPEAT).toContain("inputs.repeat");
    expect(env?.REPEAT).toContain("3"); // the scheduled run has no inputs: falls back to the default
  });

  it("runs a 2-way shard matrix", () => {
    expect(soakJob(workflow).strategy?.matrix?.shard).toEqual([1, 2]);
  });

  it("uploads the Playwright and Allure reports with if: always()", () => {
    const uploads = stepsOf(workflow).filter((s) =>
      s.uses?.startsWith("actions/upload-artifact@"),
    );
    const byPath = (p: string) => uploads.find((u) => u.with?.path === p);
    for (const p of ["playwright-report/", "allure-results/"]) {
      const upload = byPath(p);
      expect(upload, p).toBeDefined();
      expect(upload?.if).toBe("always()");
      expect(String(upload?.with?.name)).toContain("${{ matrix.shard }}");
    }
  });

  it("shares ci.yml's concurrency group and never cancels a run", () => {
    const ci = parse(ciText) as Workflow;
    expect(ci.concurrency?.group).toBeDefined();
    expect(workflow.concurrency?.group).toBe(ci.concurrency?.group);
    expect(
      (workflow.concurrency as { "cancel-in-progress"?: unknown })[
        "cancel-in-progress"
      ],
    ).toBe(false);
  });

  it("pins every action to a 40-hex SHA", () => {
    for (const step of stepsOf(workflow)) {
      if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("is not part of ci.yml's jobs or gate", () => {
    const ci = parse(ciText) as Workflow;
    for (const job of Object.values(ci.jobs ?? {})) {
      expect(
        ([] as string[])
          .concat((job as { needs?: string | string[] }).needs ?? [])
          .some((n) => /soak/i.test(n)),
      ).toBe(false);
    }
    expect(ciText).not.toContain("e2e-soak");
  });
});

describe("playwright.config.ts under the soak", () => {
  it("keeps retries 0, workers 1, timeout 60000 and expect.timeout 10000", () => {
    expect(checkConfig(configText)).toEqual([]);
  });

  it("fails the check for a copy of the config with retries: 1", () => {
    const copy = configText.replace(/retries:\s*0/, "retries: 1");
    expect(copy).not.toBe(configText);
    expect(checkConfig(copy)).toEqual(["retries is 1, expected 0"]);
  });

  it("fails the check for a copy with workers 2, a shorter timeout or a longer expect timeout", () => {
    expect(
      checkConfig(configText.replace(/workers:\s*1/, "workers: 2")),
    ).toEqual(["workers is 2, expected 1"]);
    expect(
      checkConfig(configText.replace(/timeout:\s*60000/, "timeout: 30000")),
    ).toEqual(["timeout is 30000, expected 60000"]);
    expect(
      checkConfig(configText.replace(/timeout:\s*10000/, "timeout: 20000")),
    ).toEqual(["expect.timeout is 20000, expected 10000"]);
  });
});

/** The `timeout-minutes` every ci.yml job that predates the soak carried; a larger value is a raised bound. */
const CI_TIMEOUT_CEILINGS: Record<string, number> = {
  quality: 20,
  e2e: 40,
  report: 15,
  gate: 5,
  publish: 10,
};
/** The soak job's own bound: sized for repeat x suite time, and the ceiling it may not exceed. */
const SOAK_TIMEOUT_MINUTES = 180;

/** One message per job whose timeout is missing or above its ceiling (ci.yml jobs and the soak job). */
function timeoutProblems(ci: Workflow, soak: Workflow): string[] {
  const problems: string[] = [];
  for (const [name, ceiling] of Object.entries(CI_TIMEOUT_CEILINGS)) {
    const value = ci.jobs?.[name]?.["timeout-minutes"];
    if (typeof value !== "number" || value > ceiling)
      problems.push(
        `ci.yml job ${name} timeout-minutes is ${String(value)}, expected at most ${ceiling}`,
      );
  }
  const soakValue = soakJob(soak)["timeout-minutes"];
  if (typeof soakValue !== "number" || soakValue > SOAK_TIMEOUT_MINUTES)
    problems.push(
      `soak timeout-minutes is ${String(soakValue)}, expected at most ${SOAK_TIMEOUT_MINUTES}`,
    );
  return problems;
}

describe("workflow timeouts are not raised", () => {
  const ci = parse(ciText) as Workflow;
  const soak = parse(soakText) as Workflow;

  it("keeps ci.yml's e2e job at 40 minutes and the soak job at 180", () => {
    expect(ci.jobs?.e2e?.["timeout-minutes"]).toBe(40);
    expect(soakJob(soak)["timeout-minutes"]).toBe(180);
    expect(timeoutProblems(ci, soak)).toEqual([]);
  });

  it("fails for a copy with the e2e timeout raised to 41", () => {
    const copy = parse(
      ciText.replace(/timeout-minutes: 40\b/, "timeout-minutes: 41"),
    ) as Workflow;
    expect(timeoutProblems(copy, soak)).toEqual([
      "ci.yml job e2e timeout-minutes is 41, expected at most 40",
    ]);
  });

  it("fails for a soak timeout raised to 181 or removed", () => {
    const raised = parse(
      soakText.replace(/timeout-minutes: 180\b/, "timeout-minutes: 181"),
    ) as Workflow;
    expect(timeoutProblems(ci, raised)).toEqual([
      "soak timeout-minutes is 181, expected at most 180",
    ]);
    const removed = parse(
      soakText.replace(/^\s*timeout-minutes: 180\n/m, ""),
    ) as Workflow;
    expect(timeoutProblems(ci, removed)).toEqual([
      "soak timeout-minutes is undefined, expected at most 180",
    ]);
  });

  it("fails for a raised quality or report job (other jobs of the same rule)", () => {
    const copy = parse(
      ciText
        .replace(/timeout-minutes: 20\b/, "timeout-minutes: 30")
        .replace(/timeout-minutes: 15\b/, "timeout-minutes: 16"),
    ) as Workflow;
    expect(timeoutProblems(copy, soak)).toEqual([
      "ci.yml job quality timeout-minutes is 30, expected at most 20",
      "ci.yml job report timeout-minutes is 16, expected at most 15",
    ]);
  });
});
