// Settings of the test runners that the Jenkins lanes rely on (Jenkinsfile and the repocheck tests cover the lanes
// themselves): Playwright keeps no retries, one worker and fixed timeouts and writes its reporters; Vitest writes the
// Allure, JUnit and coverage files; the e2e and smoke scripts keep the shape the shards need; the Allure config
// carries its trend history.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import playwrightConfig from "../../playwright.config";
import vitestConfig from "../../vitest.config";

const root = path.resolve(__dirname, "../..");
const configText = readFileSync(path.join(root, "playwright.config.ts"), "utf8");

/** Reads a numeric `key: value` setting out of the config text (the `expect` timeout is nested, so it is matched by
 * its own indentation). Returns undefined when the key is missing. */
function configNumber(text: string, key: string): number | undefined {
  const match = new RegExp(`^\\s*${key}:\\s*(\\d+)\\b`, "m").exec(text);
  return match ? Number(match[1]) : undefined;
}

/** One message per way the config's runtime settings differ from the required ones. */
function checkConfig(text: string): string[] {
  const problems: string[] = [];
  const wanted: Array<[string, number]> = [
    ["retries", 0],
    ["workers", 1],
    ["timeout", 60000],
  ];
  for (const [key, value] of wanted) {
    const actual = configNumber(text, key);
    if (actual !== value) problems.push(`${key} is ${String(actual)}, expected ${value}`);
  }
  const expectBlock = /expect:\s*\{([^}]*)\}/.exec(text);
  const expectTimeout = expectBlock ? configNumber(expectBlock[1], "timeout") : undefined;
  if (expectTimeout !== 10000) problems.push(`expect.timeout is ${String(expectTimeout)}, expected 10000`);
  return problems;
}

const REQUIRED_REPORTERS = ["html", "list", "allure-playwright", "json"];

/** Names of the reporters a Playwright config declares. */
function reporterNames(config: { reporter?: unknown }): string[] {
  const reporter = config.reporter;
  if (!Array.isArray(reporter)) return [];
  return reporter.map((r) => (Array.isArray(r) ? String(r[0]) : String(r)));
}

function reporterProblems(config: { reporter?: unknown }): string[] {
  const names = reporterNames(config);
  return REQUIRED_REPORTERS.filter((r) => !names.includes(r)).map((r) => `missing reporter ${r}`);
}

describe("playwright.config.ts runtime settings", () => {
  it("keeps retries 0, workers 1, timeout 60000 and expect.timeout 10000", () => {
    expect(checkConfig(configText)).toEqual([]);
    expect(playwrightConfig.retries).toBe(0);
    expect(playwrightConfig.workers).toBe(1);
    expect(playwrightConfig.timeout).toBe(60000);
    expect(playwrightConfig.expect?.timeout).toBe(10000);
  });

  it("never reads the retry count from the environment", () => {
    expect(configText).toMatch(/^\s*retries:\s*0\b/m);
    expect(configText).not.toMatch(/retries:\s*process\.env/);
  });

  it("fails the check for a copy of the config with retries: 1", () => {
    const copy = configText.replace(/retries:\s*0/, "retries: 1");
    expect(copy).not.toBe(configText);
    expect(checkConfig(copy)).toEqual(["retries is 1, expected 0"]);
  });

  it("fails the check for a copy with workers 2, a shorter timeout or a longer expect timeout", () => {
    expect(checkConfig(configText.replace(/workers:\s*1/, "workers: 2"))).toEqual(["workers is 2, expected 1"]);
    expect(checkConfig(configText.replace(/timeout:\s*60000/, "timeout: 30000"))).toEqual(["timeout is 30000, expected 60000"]);
    expect(checkConfig(configText.replace(/timeout:\s*10000/, "timeout: 20000"))).toEqual(["expect.timeout is 20000, expected 10000"]);
  });
});

describe("playwright.config.ts reporters", () => {
  it("writes html, list, Allure and json results", () => {
    expect(reporterProblems(playwrightConfig)).toEqual([]);
  });

  it("flags a removed allure-playwright, json or list reporter (negative cases)", () => {
    expect(reporterProblems({ reporter: [["html"], ["list"]] })).toEqual(["missing reporter allure-playwright", "missing reporter json"]);
    expect(reporterProblems({ reporter: [["html"], ["allure-playwright"], ["json"]] })).toEqual(["missing reporter list"]);
    expect(reporterProblems({ reporter: [["html"], ["list"], ["allure-playwright"], ["json"]] })).toEqual([]);
    expect(reporterProblems({ reporter: [["html"], ["list"], ["allure-playwright"]] })).toEqual(["missing reporter json"]);
  });
});

type Config = { test?: { reporters?: unknown; coverage?: { reporter?: unknown } } };

const REQUIRED_VITEST_REPORTERS = ["allure-vitest/reporter", "junit"];
const REQUIRED_COVERAGE_REPORTERS = ["json", "json-summary", "lcov", "html"];

function entryNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((r) => (Array.isArray(r) ? String(r[0]) : String(r)));
}

/** One problem string per Vitest reporter or coverage reporter the config lost. */
function vitestProblems(config: Config): string[] {
  const reporters = entryNames(config.test?.reporters);
  const coverage = entryNames(config.test?.coverage?.reporter);
  return [
    ...REQUIRED_VITEST_REPORTERS.filter((r) => !reporters.includes(r)).map((r) => `missing reporter ${r}`),
    ...REQUIRED_COVERAGE_REPORTERS.filter((r) => !coverage.includes(r)).map((r) => `missing coverage reporter ${r}`),
  ];
}

describe("vitest.config.ts reporters", () => {
  it("writes Allure results, a JUnit file and json-summary/lcov/html/json coverage", () => {
    expect(vitestProblems(vitestConfig as Config)).toEqual([]);
  });

  it("flags a lost allure-vitest, JUnit or json-summary reporter (negative cases)", () => {
    const cfg = (reporters: unknown[], coverage: unknown[]): Config => ({ test: { reporters, coverage: { reporter: coverage } } });
    const cov = ["text", "json", "json-summary", "html", "lcov"];
    const rep = ["default", ["allure-vitest/reporter", {}], ["junit", {}]];
    expect(vitestProblems(cfg(rep, cov))).toEqual([]);
    expect(vitestProblems(cfg(rep.slice(0, 1).concat(rep.slice(2)), cov))).toEqual(["missing reporter allure-vitest/reporter"]);
    expect(vitestProblems(cfg(rep.slice(0, 2), cov))).toEqual(["missing reporter junit"]);
    expect(vitestProblems(cfg(rep, cov.filter((c) => c !== "json-summary")))).toEqual(["missing coverage reporter json-summary"]);
    expect(vitestProblems({ test: {} })).toHaveLength(6);
  });
});

describe("scripts the e2e shards and the packaging smoke rely on", () => {
  it("e2e-docker.sh puts the shard index in network and LocalStack names and forwards args", () => {
    const text = readFileSync(path.join(root, "scripts/e2e-docker.sh"), "utf8");
    expect(text).toMatch(/RUN_ID="[^"]*shard\$\{SHARD_INDEX\}[^"]*"/);
    expect(text).toMatch(/NET="[^"]*\$\{RUN_ID\}"/);
    expect(text).toMatch(/LS="[^"]*\$\{RUN_ID\}"/);
    expect(text).toMatch(/playwright test "\$@"/);
  });

  it("the AppImage smoke script extracts the AppImage and launches it under xvfb in the Playwright image", () => {
    const script = readFileSync(path.join(root, "scripts/smoke-appimage.sh"), "utf8");
    expect(script).toContain("--appimage-extract");
    expect(script).toContain("xvfb-run");
    expect(script).toContain("mcr.microsoft.com/playwright:v");
    expect(script).toContain("--no-sandbox");
  });

  it("the Allure config keeps its trend history", () => {
    const config = readFileSync(path.join(root, "scripts/allurerc.mjs"), "utf8");
    expect(config).toMatch(/appendHistory:\s*true/);
    expect(config).toMatch(/historyPath:\s*'\.\/allure-report\/history\.jsonl'/);
  });
});
