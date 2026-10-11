// Vitest config used by Stryker (stryker.config.mjs): the unit-test config minus the allure setup file and reporters, which
// cannot be resolved from Stryker's sandbox (its node_modules is a symlink to the real one). Same tests, same assertions.
import base from './vitest.config.ts';

const test = base.test ?? {};
export default {
  ...base,
  test: {
    ...test,
    setupFiles: (test.setupFiles as string[]).filter((file) => !file.startsWith('allure-vitest')),
    reporters: ['default'],
  },
};
