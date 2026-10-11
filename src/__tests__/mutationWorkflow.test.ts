// .github/workflows/mutation.yml (SPEC sections 4 and 5): the mutation set runs on the self-hosted runner on a weekly
// schedule, on demand and on owner pull requests that touch a mutated module, uploads its report on every outcome,
// and is not part of ci.yml's gate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

type Step = { name?: string; 'continue-on-error'?: boolean; uses?: string; run?: string; if?: string; with?: Record<string, unknown> };
type Job = {
  'runs-on'?: unknown;
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  steps?: Step[];
};
type Workflow = { on?: Record<string, unknown>; jobs?: Record<string, Job> };

const root = path.resolve(__dirname, '../..');
const mutationText = readFileSync(path.join(root, '.github/workflows/mutation.yml'), 'utf8');
const ciText = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');

async function strykerMutateList(): Promise<string[]> {
  const config = (await import(pathToFileURL(path.join(root, 'stryker.config.mjs')).href)) as {
    default: { mutate: string[] };
  };
  return config.default.mutate;
}

/** One message per way the workflow's pull_request `paths` differ from the mutate list; empty means equal. */
function comparePaths(workflow: Workflow, mutate: string[]): string[] {
  const pr = workflow.on?.pull_request as { paths?: string[] } | undefined;
  const paths = pr?.paths ?? [];
  const problems: string[] = [];
  for (const file of mutate) if (!paths.includes(file)) problems.push(`paths is missing ${file}`);
  for (const file of paths) if (!mutate.includes(file)) problems.push(`paths has extra ${file}`);
  return problems;
}

const mutationJob = (workflow: Workflow): Job => Object.values(workflow.jobs ?? {})[0] ?? {};
const stepsOf = (workflow: Workflow): Step[] => mutationJob(workflow).steps ?? [];

describe('mutation.yml', () => {
  const workflow = parse(mutationText) as Workflow;

  it('triggers on a weekly schedule, workflow_dispatch and pull_request', () => {
    expect(Object.keys(workflow.on ?? {}).sort()).toEqual(['pull_request', 'schedule', 'workflow_dispatch']);
    const schedule = workflow.on?.schedule as Array<{ cron: string }>;
    expect(schedule).toHaveLength(1);
    // five fields with a fixed day of week and no day-of-month or month wildcard stepping = once a week
    expect(schedule[0].cron).toMatch(/^\d+ \d+ \* \* \d$/);
  });

  it('runs `npm run mutation` on the s3-browser self-hosted runner', () => {
    expect(mutationJob(workflow)['runs-on']).toEqual(['self-hosted', 'linux', 'x64', 's3-browser']);
    expect(stepsOf(workflow).some((s) => s.run?.trim() === 'npm run mutation')).toBe(true);
  });

  it('gates pull requests on a same-repo PR opened by the owner', () => {
    const condition = mutationJob(workflow).if ?? '';
    expect(condition).toContain("github.event_name != 'pull_request'");
    expect(condition).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(condition).toContain("github.event.pull_request.user.login == 'n-orlov'");
    expect(condition).toContain("github.actor == 'n-orlov'");
    expect(Object.keys(workflow.on ?? {})).not.toContain('pull_request_target');
  });

  it("has pull_request paths equal to the Stryker config's mutate list", async () => {
    const mutate = await strykerMutateList();
    expect(mutate.length).toBeGreaterThan(0);
    expect(comparePaths(workflow, mutate)).toEqual([]);
  });

  it('fails the paths comparison when one path is dropped', async () => {
    const mutate = await strykerMutateList();
    const pr = workflow.on?.pull_request as { paths: string[] };
    const dropped: Workflow = { on: { pull_request: { paths: pr.paths.slice(1) } } };
    expect(comparePaths(dropped, mutate)).toEqual([`paths is missing ${mutate[0]}`]);
  });

  it('fails the paths comparison when a path is added', async () => {
    const mutate = await strykerMutateList();
    const pr = workflow.on?.pull_request as { paths: string[] };
    const added: Workflow = { on: { pull_request: { paths: [...pr.paths, 'src/extra.ts'] } } };
    expect(comparePaths(added, mutate)).toEqual(['paths has extra src/extra.ts']);
  });

  it('uploads reports/mutation/ as mutation-report with if: always()', () => {
    const upload = stepsOf(workflow).find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(upload).toBeDefined();
    expect(upload?.if).toBe('always()');
    expect(upload?.with?.name).toBe('mutation-report');
    expect(upload?.with?.path).toBe('reports/mutation/');
  });

  it('writes the per-module scores to $GITHUB_STEP_SUMMARY with if: always()', () => {
    const summary = stepsOf(workflow).find((s) => s.run?.includes('GITHUB_STEP_SUMMARY'));
    expect(summary).toBeDefined();
    expect(summary?.if).toBe('always()');
    expect(summary?.run).toContain('npm run --silent mutation -- --check-only');
  });

  it('pins every action to a 40-hex SHA', () => {
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it("is not part of ci.yml's gate", () => {
    const ci = parse(ciText) as Workflow;
    const needs = ([] as string[]).concat(ci.jobs?.gate?.needs ?? []);
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.some((n) => /mutation/i.test(n))).toBe(false);
    for (const job of Object.values(ci.jobs ?? {})) {
      expect(([] as string[]).concat(job.needs ?? []).some((n) => /mutation/i.test(n))).toBe(false);
    }
    expect(ciText).not.toContain('mutation.yml');
    expect(ciText).not.toMatch(/npm run mutation/);
  });
});

describe('mutation.yml publish job (badges/mutation.json on gh-pages)', () => {
  const workflow = parse(mutationText) as Workflow;
  const publish = (wf: Workflow): Job => wf.jobs?.publish ?? {};
  const events = ['pull_request', 'schedule', 'workflow_dispatch'];

  /** Whether the job's event terms admit one event: `==` terms list the admitted events, `!=` terms exclude. */
  const runsFor = (job: Job, event: string): boolean => {
    const condition = job.if ?? '';
    const listed = [...condition.matchAll(/github\.event_name == '([^']+)'/g)].map((m) => m[1]);
    const excluded = [...condition.matchAll(/github\.event_name != '([^']+)'/g)].map((m) => m[1]);
    if (listed.length > 0) return listed.includes(event);
    return !excluded.includes(event);
  };

  it('runs only on schedule or workflow_dispatch: its if excludes pull_request', () => {
    const job = publish(workflow);
    expect(job.if).toBeDefined();
    expect(runsFor(job, 'schedule')).toBe(true);
    expect(runsFor(job, 'workflow_dispatch')).toBe(true);
    expect(runsFor(job, 'pull_request')).toBe(false);
    expect(job.if).not.toMatch(/pull_request/);
  });

  it('is limited to the master ref', () => {
    expect(publish(workflow).if).toContain("github.ref == 'refs/heads/master'");
  });

  it('holds contents: write at job level only; the workflow and the mutation job stay read-only', () => {
    expect(publish(workflow).permissions).toEqual({ contents: 'write' });
    expect((workflow as { permissions?: unknown }).permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs?.mutation?.permissions).toBeUndefined();
    const writers = Object.entries(workflow.jobs ?? {}).filter(([, j]) =>
      Object.values(j.permissions ?? {}).includes('write'),
    );
    expect(writers.map(([name]) => name)).toEqual(['publish']);
  });

  it("needs the mutation job and shares ci.yml publish's concurrency group without cancelling", () => {
    const ci = parse(ciText) as Workflow;
    const job = publish(workflow);
    expect(job.needs).toBe('mutation');
    expect(job.concurrency?.group).toBe('publish-allure-report');
    expect(job.concurrency?.group).toBe(ci.jobs?.publish?.concurrency?.group);
    expect(job.concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('downloads mutation-report, renders the badge and commits only badges/mutation.json onto the existing gh-pages', () => {
    const steps = publish(workflow).steps ?? [];
    const download = steps.find((s) => s.uses?.startsWith('actions/download-artifact@'));
    expect(download?.with?.name).toBe('mutation-report');
    expect(steps.some((s) => /npm run [^\n]*badges/.test(s.run ?? ''))).toBe(true);
    const push = steps.find((s) => /git push/.test(s.run ?? ''));
    expect(push?.run).toContain('git fetch');
    expect(push?.run).toContain('origin gh-pages');
    expect(push?.run).not.toMatch(/--orphan|--force|push -f|git rm/);
    expect(push?.run).toContain('git add badges/mutation.json');
    expect(push?.run).not.toMatch(/git add (--all|-A|\.)/);
  });

  it('survives a missing mutation-report artifact: the download tolerates failure and no step between it and the commit has a failure-sensitive gate', () => {
    const steps = publish(workflow).steps ?? [];
    const downloadAt = steps.findIndex((s) => s.uses?.startsWith('actions/download-artifact@'));
    const renderAt = steps.findIndex((s) => /npm run [^\n]*badges/.test(s.run ?? ''));
    const commitAt = steps.findIndex((s) => /git push/.test(s.run ?? ''));
    expect(downloadAt).toBeGreaterThanOrEqual(0);
    expect(downloadAt).toBeLessThan(renderAt);
    expect(renderAt).toBeLessThan(commitAt);
    expect(steps[downloadAt]?.['continue-on-error']).toBe(true);
    // The render step must name the mutation file explicitly, so a missing one is n/a rather than another file's score.
    expect(steps[renderAt]?.run).toContain('--mutation reports/mutation/mutation.json');
    // Steps after the download keep the implicit success() gate only because the download cannot fail the job.
    for (const step of steps.slice(downloadAt + 1, commitAt + 1)) expect(step.if ?? '').not.toMatch(/failure\(\)|hashFiles/);
    // The mutation job's report upload must stay unconditional, and the publish job must run after a failed mutation job.
    expect(publish(workflow).if).toContain('!cancelled()');
  });

  it('sees an if that a pull_request could reach as reachable (negative fixture)', () => {
    const broken: Job = { if: "github.event_name != 'push'" };
    expect(runsFor(broken, 'pull_request')).toBe(true);
    const events2 = events.filter((e) => runsFor(broken, e));
    expect(events2).toContain('pull_request');
  });
});
