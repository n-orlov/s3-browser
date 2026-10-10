// Proves the repository's ESLint config forbids `waitForTimeout` in e2e/ (R4.8) by linting fixture
// sources through the ESLint Node API with the real eslint.config.mjs.
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

const repo = path.resolve(__dirname, '../..');
const eslint = new ESLint({ cwd: repo });

async function restrictedSyntaxMessages(source: string, file: string) {
  const [result] = await eslint.lintText(source, { filePath: path.join(repo, file) });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
}

const withSleep = "export async function f(page: any) {\n  await page.waitForTimeout(100);\n}\n";
const withoutSleep = "export async function f(page: any) {\n  await page.locator('h2').click();\n}\n";

describe('e2e fixed-sleep ban', () => {
  it('reports waitForTimeout under e2e/ as an error', async () => {
    const messages = await restrictedSyntaxMessages(withSleep, 'e2e/fixture.e2e.ts');
    expect(messages).toHaveLength(1);
    expect(messages[0].severity).toBe(2);
    expect(messages[0].message).toContain('waitForTimeout');
  });

  it('reports the bracket-notation call too', async () => {
    const messages = await restrictedSyntaxMessages("export async function f(page: any) {\n  await page['waitForTimeout'](100);\n}\n", 'e2e/fixture.e2e.ts');
    expect(messages).toHaveLength(1);
    expect(messages[0].severity).toBe(2);
  });

  it('reports nothing for the same fixture without the call', async () => {
    expect(await restrictedSyntaxMessages(withoutSleep, 'e2e/fixture.e2e.ts')).toEqual([]);
  });

  it('does not apply the rule outside e2e/', async () => {
    expect(await restrictedSyntaxMessages(withSleep, 'src/fixture.ts')).toEqual([]);
  });
});
