import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

const FULL_SHA = /^[0-9a-f]{40}$/;

/** Returns one problem string per `uses:` ref that is not a 40-hex commit SHA. */
function unpinnedActions(workflow: unknown): string[] {
  const problems: string[] = [];
  const jobs = (workflow as { jobs?: Record<string, { steps?: unknown[] }> })
    ?.jobs;
  for (const [jobName, job] of Object.entries(jobs ?? {})) {
    for (const step of job.steps ?? []) {
      const uses = (step as { uses?: unknown }).uses;
      if (typeof uses !== "string") continue;
      const at = uses.lastIndexOf("@");
      const ref = at < 0 ? "" : uses.slice(at + 1);
      if (!FULL_SHA.test(ref)) {
        problems.push(`${jobName}: ${uses} is not pinned to a 40-hex SHA`);
      }
    }
  }
  return problems;
}

describe("ci.yml action pinning", () => {
  const ciText = readFileSync(
    path.resolve(__dirname, "../../.github/workflows/ci.yml"),
    "utf8",
  );

  it("pins every uses: ref to a full commit SHA", () => {
    expect(unpinnedActions(parse(ciText))).toEqual([]);
  });

  it("records the release tag in a trailing comment on every uses: line", () => {
    const lines = ciText.split("\n").filter((l) => /\buses:/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/@[0-9a-f]{40} # v\d+(\.\d+)*\s*$/);
    }
  });

  it("flags tag and branch refs (validator negative cases)", () => {
    const wf = (uses: string) => ({ jobs: { j: { steps: [{ uses }] } } });
    expect(unpinnedActions(wf("actions/checkout@v4"))).toHaveLength(1);
    expect(unpinnedActions(wf("actions/checkout@main"))).toHaveLength(1);
    expect(unpinnedActions(wf("actions/checkout"))).toHaveLength(1);
    expect(
      unpinnedActions(wf("actions/checkout@" + "a".repeat(39))),
    ).toHaveLength(1);
    expect(unpinnedActions(wf("actions/checkout@" + "a".repeat(40)))).toEqual(
      [],
    );
  });
});
