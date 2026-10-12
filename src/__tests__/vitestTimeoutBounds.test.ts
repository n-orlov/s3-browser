// Pins the PRD prohibition on a raised timeout / per-test bound: the unit tier runs on Vitest's
// own defaults (5 s per test, 10 s per hook), so a slow test is made faster, never given more time.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import config from '../../vitest.config';

const testDir = __dirname;

describe('vitest timeout bounds', () => {
  it.each(['testTimeout', 'hookTimeout', 'teardownTimeout'])('does not override %s in vitest.config.ts', (key) => {
    expect(Object.keys(config.test ?? {})).not.toContain(key);
  });

  it('does not retry a failing unit test', () => {
    expect(config.test?.retry).toBeUndefined();
  });

  it('runs this very test under the default 5 s per-test timeout', () => {
    // vitest exposes the resolved per-test timeout on the runner config.
    expect(Number((globalThis as { __vitest_worker__?: { config?: { testTimeout?: number } } }).__vitest_worker__?.config?.testTimeout)).toBe(5000);
  });

  it('gives no test a per-test timeout above 5 s beyond the pre-existing crapCli baseline', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(testDir).filter((f) => /\.test\.tsx?$/.test(f) && f !== 'crapCli.test.ts' && f !== 'vitestTimeoutBounds.test.ts')) {
      const source = readFileSync(path.join(testDir, file), 'utf8');
      for (const m of source.matchAll(/\}\s*,\s*(\d[\d_]*)\s*\)\s*;/g)) {
        if (Number(m[1].replace(/_/g, '')) > 5000) offenders.push(`${file}: ${m[1]}`);
      }
      if (/vi\.setConfig\(|\.setTimeout\(|\{\s*timeout:\s*\d{5,}/.test(source)) offenders.push(`${file}: setConfig/setTimeout/timeout option`);
    }
    expect(offenders).toEqual([]);
  });
});
