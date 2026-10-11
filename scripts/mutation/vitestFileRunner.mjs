// Stryker test-runner plugin `vitest-file`: @stryker-mutator/vitest-runner 10 narrows a mutant run to the covering tests with a
// `-t` name regex built from space-joined names ("describe test"), but Vitest 5 matches `-t` against `fullTestName`, which joins
// the names with " > ". The regex then matches nothing, every test is skipped and every mutant "survives" with 0 tests run.
// This wrapper narrows a mutant run to the covering test FILES instead (the test id with its name part emptied matches every test
// in the file) and otherwise delegates to the vitest runner unchanged. Remove it when the vitest runner builds Vitest 5 patterns.
import { PluginKind, commonTokens, declareFactoryPlugin, tokens } from '@stryker-mutator/api/plugin';
import { strykerPlugins as vitestPlugins } from '@stryker-mutator/vitest-runner';

const vitestFactory = vitestPlugins.find((plugin) => plugin.kind === PluginKind.TestRunner && plugin.name === 'vitest').factory;

/** Maps covering test ids (`<file>#<describe> <test>`) to one name-less id per file. */
export function toFileFilter(testFilter) {
  if (!testFilter || testFilter.length === 0) return testFilter;
  const files = new Set(testFilter.map((id) => id.split('#')[0]));
  return [...files].map((file) => `${file}#`);
}

class FileLevelTestRunner {
  constructor(inner) {
    this.inner = inner;
  }
  capabilities() {
    return this.inner.capabilities();
  }
  init() {
    return this.inner.init();
  }
  dryRun(options) {
    return this.inner.dryRun(options);
  }
  mutantRun(options) {
    return this.inner.mutantRun({ ...options, testFilter: toFileFilter(options.testFilter) });
  }
  dispose() {
    return this.inner.dispose();
  }
}

function createFileLevelRunner(injector) {
  return new FileLevelTestRunner(vitestFactory(injector));
}
createFileLevelRunner.inject = tokens(commonTokens.injector);

export const strykerPlugins = [declareFactoryPlugin(PluginKind.TestRunner, 'vitest-file', createFileLevelRunner)];
