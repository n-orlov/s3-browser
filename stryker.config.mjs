// Mutation testing (SPEC section 4). The closed set of modules mutated by `npm run mutation` is exactly these 8 files:
//   scripts/crap/crapScore.ts, scripts/ratchet/ratchetCheck.ts, scripts/summary/jobSummary.ts  (the quality-gate logic)
//   src/main/ipc/validate.ts, src/main/externalUrlPolicy.ts, src/main/windowSecurity.ts       (IPC validation, navigation policy)
//   src/main/services/s3Url.ts, src/main/services/gzipUtils.ts                                (S3 URL parsing, gzip size bound)
// Stryker's `thresholds.break` is a whole-run score; `scripts/mutation/mutation.ts` additionally fails when any single
// module in this set scores below the same break (scripts/mutation/mutationCheck.ts).
import path from 'node:path';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest-file',
  plugins: ['@stryker-mutator/vitest-runner', path.resolve('scripts/mutation/vitestFileRunner.mjs')],
  vitest: { configFile: 'vitest.mutation.config.ts', related: false },
  mutate: [
    'scripts/crap/crapScore.ts',
    'scripts/ratchet/ratchetCheck.ts',
    'scripts/summary/jobSummary.ts',
    'src/main/ipc/validate.ts',
    'src/main/externalUrlPolicy.ts',
    'src/main/windowSecurity.ts',
    'src/main/services/s3Url.ts',
    'src/main/services/gzipUtils.ts',
  ],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: 85, break: 80 },
  coverageAnalysis: 'perTest',
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
};
