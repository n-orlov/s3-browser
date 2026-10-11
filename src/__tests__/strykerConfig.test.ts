// Stryker config parity: thresholds.break equals .ratchet.json mutationScoreMin, and `mutate` is exactly the closed set the config's own header comment names.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseRatchet, readMutationBreak } from '../../scripts/ratchet/ratchetCheck.ts';

const repo = path.resolve(__dirname, '../..');
const configPath = path.join(repo, 'stryker.config.mjs');
const configText = readFileSync(configPath, 'utf8');

/** The module paths the config's header comment lists: its indented `//   a.ts, b.ts   (why)` lines, before the parenthesis. */
function namedModules(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('//   '))
    .flatMap((line) => [...line.split('(')[0].matchAll(/\b((?:scripts|src)\/[\w./-]+\.ts)\b/g)].map((m) => m[1]));
}

/** One message per way `mutate` differs from the named closed set; empty means they are equal. */
function compareSets(named: string[], mutate: string[]): string[] {
  const problems: string[] = [];
  for (const file of named) if (!mutate.includes(file)) problems.push(`mutate is missing ${file}`);
  for (const file of mutate) if (!named.includes(file)) problems.push(`mutate has unnamed ${file}`);
  if (new Set(mutate).size !== mutate.length) problems.push('mutate has duplicates');
  return problems;
}

describe('stryker.config.mjs parity', () => {
  it("has thresholds.break equal to .ratchet.json's mutationScoreMin", async () => {
    const config = (await import(pathToFileURL(configPath).href)) as { default: { thresholds: { break: number } } };
    const ratchet = parseRatchet(readFileSync(path.join(repo, '.ratchet.json'), 'utf8'));
    expect(config.default.thresholds.break).toBe(ratchet.mutationScoreMin);
    expect(readMutationBreak(configText)).toBe(ratchet.mutationScoreMin);
  });

  it("has a mutate list equal to the closed set of 8 modules named in the config's own comment", async () => {
    const config = (await import(pathToFileURL(configPath).href)) as { default: { mutate: string[] } };
    const named = namedModules(configText);
    expect(named).toHaveLength(8);
    expect(compareSets(named, config.default.mutate)).toEqual([]);
  });

  it('fails when one mutate entry is dropped', async () => {
    const config = (await import(pathToFileURL(configPath).href)) as { default: { mutate: string[] } };
    const named = namedModules(configText);
    const dropped = config.default.mutate.slice(1);
    expect(compareSets(named, dropped)).toEqual([`mutate is missing ${config.default.mutate[0]}`]);
  });

  it('fails when a mutate entry is not named in the comment', () => {
    expect(compareSets(['a.ts'], ['a.ts', 'src/b.ts'])).toEqual(['mutate has unnamed src/b.ts']);
  });
});
