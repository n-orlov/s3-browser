// Mutation gate: `npm run mutation` runs Stryker over the closed module set in stryker.config.mjs (HTML + JSON reports in
// reports/mutation/) and then fails when any single module scores below thresholds.break. `--check-only [report]` skips Stryker
// and judges an existing JSON report. Run from the repository root.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkModules, type MutationReportLike } from './mutationCheck.ts';

const root = process.cwd();
const args = process.argv.slice(2);
const checkOnly = args[0] === '--check-only';
const reportPath = path.resolve(root, (checkOnly ? args[1] : undefined) ?? 'reports/mutation/mutation.json');

try {
  const config = ((await import(pathToFileURL(path.join(root, 'stryker.config.mjs')).href)) as {
    default: { mutate: string[]; thresholds: { break: number } };
  }).default;
  let strykerStatus = 0;
  if (!checkOnly) {
    const run = spawnSync(path.join(root, 'node_modules/.bin/stryker'), ['run'], { stdio: 'inherit', cwd: root });
    strykerStatus = run.status ?? 1;
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as MutationReportLike;
  const { scores, failures } = checkModules(report, config.mutate, config.thresholds.break);
  for (const entry of scores) {
    console.log(`MUTATION ${entry.score === null ? 'n/a' : `${entry.score.toFixed(2)}%`}  ${entry.module}`);
  }
  for (const failure of failures) console.error(`MUTATION FAIL ${failure}`);
  if (strykerStatus !== 0) console.error(`mutation: stryker exited ${strykerStatus} (whole-run score below the break or a run error)`);
  if (failures.length > 0 || strykerStatus !== 0) process.exit(1);
  console.log('mutation: ok');
} catch (error) {
  console.error(`mutation: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
