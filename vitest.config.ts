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
    ],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
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
        branches: 72,
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
