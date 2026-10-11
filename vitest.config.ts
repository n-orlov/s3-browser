import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Several suites spawn real child processes (badges CLI, Playwright, bash gate); the 5 s default flakes on a loaded shared runner.
    testTimeout: 30000,
    environment: 'jsdom',
    setupFiles: ['allure-vitest/setup', './src/__tests__/setup.ts'],
    reporters: [
      'default',
      ['allure-vitest/reporter', { resultsDir: 'allure-results-unit' }],
      ['junit', { outputFile: 'junit/junit.xml' }],
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
        lines: 84,
        functions: 83,
        branches: 74,
        statements: 83,
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
