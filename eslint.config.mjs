import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'node_modules/**', 'reports/**', '.stryker-tmp/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      complexity: ['warn', 15],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React-compiler-era rule: 10 pre-existing hits need behavioural refactors; ratchet down, then make it an error.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}', 'e2e/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      complexity: 'off',
    },
  },  {
    // Fixed sleeps make e2e tests flaky and slow: wait on a web-first assertion (`expect(...).toBeVisible()`,
    // `expect.poll`) instead. Covered by src/__tests__/e2eNoFixedSleep.test.ts.
    files: ['e2e/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message: 'waitForTimeout is forbidden in e2e/: wait on a web-first assertion or expect.poll instead.',
        },
        {
          selector: "CallExpression[callee.property.value='waitForTimeout']",
          message: 'waitForTimeout is forbidden in e2e/: wait on a web-first assertion or expect.poll instead.',
        },
      ],
    },
  },
);
