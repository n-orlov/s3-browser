import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

type Step = { run?: string; uses?: string; with?: { name?: string } };
type Job = {
  strategy?: { matrix?: { shard?: unknown } };
  steps?: Step[];
};

/** One problem string per way the e2e job deviates from the 2-shard topology. */
function e2eShardProblems(workflow: unknown): string[] {
  const problems: string[] = [];
  const job = (workflow as { jobs?: Record<string, Job> })?.jobs?.e2e;
  if (!job) return ["no e2e job"];
  const shards = job.strategy?.matrix?.shard;
  if (JSON.stringify(shards) !== JSON.stringify([1, 2])) {
    problems.push(`e2e matrix.shard must be exactly [1, 2], got ${JSON.stringify(shards)}`);
  }
  const runs = (job.steps ?? []).map((s) => s.run ?? "");
  if (!runs.some((r) => /e2e-docker\.sh\s+--shard=\$\{\{\s*matrix\.shard\s*\}\}\/2\b/.test(r))) {
    problems.push("e2e job must run ./scripts/e2e-docker.sh --shard=${{ matrix.shard }}/2");
  }
  const uploads = (job.steps ?? []).filter((s) => s.uses?.startsWith("actions/upload-artifact@"));
  if (uploads.length === 0) problems.push("e2e job has no artifact upload");
  for (const u of uploads) {
    if (!/\$\{\{\s*matrix\.shard\s*\}\}/.test(u.with?.name ?? "")) {
      problems.push(`artifact name "${u.with?.name}" does not carry matrix.shard`);
    }
  }
  return problems;
}

const root = path.resolve(__dirname, "../..");
const ci = parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));

describe("ci.yml e2e shard matrix", () => {
  it("runs the e2e job as exactly two shards with unique artifact names", () => {
    expect(e2eShardProblems(ci)).toEqual([]);
  });

  it("flags a missing matrix, a wrong shard count and a missing --shard (negative cases)", () => {
    const wf = (job: Job) => ({ jobs: { e2e: job } });
    const run = { run: "./scripts/e2e-docker.sh --shard=${{ matrix.shard }}/2" };
    const upload = {
      uses: "actions/upload-artifact@x",
      with: { name: "e2e-report-${{ matrix.shard }}" },
    };
    const good: Job = { strategy: { matrix: { shard: [1, 2] } }, steps: [run, upload] };
    expect(e2eShardProblems(wf(good))).toEqual([]);
    expect(e2eShardProblems(wf({ ...good, strategy: undefined }))).not.toEqual([]);
    expect(e2eShardProblems(wf({ ...good, strategy: { matrix: { shard: [1, 2, 3] } } }))).not.toEqual([]);
    expect(e2eShardProblems(wf({ ...good, steps: [{ run: "./scripts/e2e-docker.sh" }, upload] }))).not.toEqual([]);
    expect(
      e2eShardProblems(wf({ ...good, steps: [run, { ...upload, with: { name: "e2e-report" } }] })),
    ).not.toEqual([]);
  });
});

describe("e2e sharding support files", () => {
  it("playwright.config.ts never retries", () => {
    const text = readFileSync(path.join(root, "playwright.config.ts"), "utf8");
    expect(text).toMatch(/^\s*retries:\s*0\b/m);
    expect(text).not.toMatch(/retries:\s*process\.env/);
  });

  it("e2e-docker.sh puts the shard index in network and LocalStack names and forwards args", () => {
    const text = readFileSync(path.join(root, "scripts/e2e-docker.sh"), "utf8");
    expect(text).toMatch(/RUN_ID="[^"]*shard\$\{SHARD_INDEX\}[^"]*"/);
    expect(text).toMatch(/NET="[^"]*\$\{RUN_ID\}"/);
    expect(text).toMatch(/LS="[^"]*\$\{RUN_ID\}"/);
    expect(text).toMatch(/playwright test "\$@"/);
  });
});
