import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['allure-vitest/setup', './src/__tests__/setup.ts'],
    reporters: [
      'default',
      ['allure-vitest/reporter', { resultsDir: 'allure-results-unit' }],
      ['junit', { outputFile: 'junit/junit.xml' }],
      // Read by ci/mark-flaky.mjs, which compares the reports of repeated runs. Retries stay 0.
      ['json', { outputFile: 'junit/vitest-results.json' }],
    ],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      // Write the coverage reports even when a test fails, so a red run still has coverage evidence.
      reportOnFailure: true,
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'src/__tests__/**',
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'src/main/index.ts',
        'src/preload/index.ts',
      ],
      thresholds: {
        lines: 92,
        functions: 89,
        branches: 83,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
