import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BADGE_NAMES,
  colorForThreshold,
  mutationScoreOf,
  parseAuditCounts,
  parseEslintCounts,
  parseRatchetInput,
  renderBadges,
  staticBadges,
  type BadgeInput,
} from "../../scripts/badges/badges";

const ratchet = {
  maxWarnings: 0,
  mutationScoreMin: 80,
  coverageThresholds: { lines: 84, functions: 83, branches: 74, statements: 83 },
};
const audit = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
const allGreen: BadgeInput = {
  ratchet,
  lint: { errors: 0, warnings: 0 },
  coverage: { pct: { lines: 92, functions: 90, branches: 82, statements: 91 } },
  crap: { max: 30, functions: 640, over: 0 },
  unit: { total: 100, failed: 0, skipped: 4 },
  e2e: { passed: 197, failed: 0, skipped: 1 },
  mutation: 100,
  audit,
};
const SHAPE = { schemaVersion: 1, label: expect.any(String), message: expect.any(String), color: expect.any(String) };

describe("renderBadges: schema", () => {
  it("renders the 10 endpoint files, each with schemaVersion 1, label, message and color", () => {
    const badges = renderBadges(allGreen);
    expect(Object.keys(badges).sort()).toEqual([...BADGE_NAMES].sort());
    expect(BADGE_NAMES).toHaveLength(10);
    for (const name of BADGE_NAMES) {
      expect(badges[name], name).toEqual(SHAPE);
      expect(Object.keys(badges[name]).sort(), name).toEqual(["color", "label", "message", "schemaVersion"]);
      expect(badges[name].message.length, name).toBeGreaterThan(0);
    }
  });

  it("renders every badge as n/a lightgrey when its inputs are missing", () => {
    const badges = renderBadges({ ratchet: null, lint: null, coverage: null, crap: null, unit: null, e2e: null, mutation: null, audit: null });
    for (const name of BADGE_NAMES) {
      expect(badges[name], name).toEqual({ ...SHAPE, message: "n/a", color: "lightgrey" });
    }
  });

  it("renders only the badge whose input is missing as n/a", () => {
    const badges = renderBadges({ ...allGreen, audit: null });
    expect(badges.audit.message).toBe("n/a");
    expect(badges.audit.color).toBe("lightgrey");
    expect(badges.crap.color).toBe("brightgreen");
    expect(badges.mutation.color).toBe("brightgreen");
  });

  it("renders a coverage badge as n/a without thresholds even when coverage exists", () => {
    expect(renderBadges({ ...allGreen, ratchet: null })["coverage-lines"].message).toBe("n/a");
  });
});

describe("renderBadges: colour boundaries", () => {
  const coverageKeys = [
    ["coverage-lines", "lines"],
    ["coverage-branches", "branches"],
    ["coverage-functions", "functions"],
    ["coverage-statements", "statements"],
  ] as const;

  for (const [name, key] of coverageKeys) {
    it(`${name}: at the threshold yellow, at threshold + 5 green, below the threshold red`, () => {
      const threshold = ratchet.coverageThresholds[key];
      const at = (value: number) => renderBadges({ ...allGreen, coverage: { pct: { ...allGreen.coverage!.pct, [key]: value } } })[name];
      expect(at(threshold).color).toBe("yellow");
      expect(at(threshold + 4.99).color).toBe("yellow");
      expect(at(threshold + 5).color).toBe("brightgreen");
      expect(at(threshold - 0.01).color).toBe("red");
      expect(at(threshold + 5).message).toBe(`${threshold + 5}%`);
    });
  }

  it("colorForThreshold uses the same rule for any threshold", () => {
    expect([colorForThreshold(10, 10), colorForThreshold(15, 10), colorForThreshold(9.9, 10)]).toEqual(["yellow", "brightgreen", "red"]);
  });

  it("crap is green only at 0 functions over the limit", () => {
    const at = (over: number) => renderBadges({ ...allGreen, crap: { max: 30, functions: 640, over } }).crap;
    expect(at(0).color).toBe("brightgreen");
    expect(at(1).color).toBe("red");
    expect(at(1).message).toBe("1 over 30");
  });

  it("lint shows ESLint's warning count and is green only at 0 warnings and 0 errors", () => {
    const at = (warnings: number, errors = 0) => renderBadges({ ...allGreen, lint: { errors, warnings } }).lint;
    expect(at(0)).toMatchObject({ color: "brightgreen", message: "0 warnings" });
    expect(at(1)).toMatchObject({ color: "yellow", message: "1 warning" });
    expect(at(7)).toMatchObject({ color: "yellow", message: "7 warnings" });
    expect(at(0, 2)).toMatchObject({ color: "red", message: "2 errors, 0 warnings" });
    expect(at(3, 1)).toMatchObject({ color: "red", message: "1 error, 3 warnings" });
  });

  it("lint ignores the .ratchet.json ceiling: a ceiling of 5 with 0 warnings is green 0, a ceiling of 0 with 4 warnings is not green", () => {
    const withCeiling = (maxWarnings: number, warnings: number) =>
      renderBadges({ ...allGreen, ratchet: { ...ratchet, maxWarnings }, lint: { errors: 0, warnings } }).lint;
    expect(withCeiling(5, 0)).toMatchObject({ color: "brightgreen", message: "0 warnings" });
    expect(withCeiling(0, 4)).toMatchObject({ color: "yellow", message: "4 warnings" });
  });

  it("lint is n/a lightgrey without an ESLint result, even when .ratchet.json is present", () => {
    expect(renderBadges({ ...allGreen, lint: null }).lint).toEqual({ ...SHAPE, label: "lint", message: "n/a", color: "lightgrey" });
  });

  it("every other badge is n/a lightgrey when only its own input is missing", () => {
    const without: [keyof BadgeInput, string][] = [
      ["coverage", "coverage-lines"],
      ["crap", "crap"],
      ["unit", "unit-tests"],
      ["e2e", "e2e-tests"],
      ["mutation", "mutation"],
      ["audit", "audit"],
      ["lint", "lint"],
    ];
    for (const [key, name] of without) {
      const badges = renderBadges({ ...allGreen, [key]: null });
      expect(badges[name as keyof typeof badges], name).toMatchObject({ message: "n/a", color: "lightgrey" });
    }
  });

  it("audit counts high+ findings: green at zero whatever the low and moderate count, red otherwise", () => {
    const at = (counts: Partial<typeof audit>) => {
      const merged = { ...audit, ...counts };
      return renderBadges({ ...allGreen, audit: { ...merged, total: merged.low + merged.moderate + merged.high + merged.critical } }).audit;
    };
    expect(at({})).toEqual({ schemaVersion: 1, label: "audit", message: "0 high+ vulnerabilities", color: "brightgreen" });
    // the independent clone's production audit: low=2, moderate=0, high=0, critical=0
    expect(at({ low: 2 })).toMatchObject({ message: "0 high+ vulnerabilities", color: "brightgreen" });
    expect(at({ low: 3, moderate: 4 })).toMatchObject({ message: "0 high+ vulnerabilities", color: "brightgreen" });
    expect(at({ moderate: 1 })).toMatchObject({ message: "0 high+ vulnerabilities", color: "brightgreen" });
    expect(at({ high: 1 })).toMatchObject({ message: "1 high+ vulnerability", color: "red" });
    expect(at({ critical: 1 })).toMatchObject({ message: "1 high+ vulnerability", color: "red" });
    expect(at({ low: 5, high: 1, critical: 1 })).toMatchObject({ message: "2 high+ vulnerabilities", color: "red" });
  });

  it("unit-tests and e2e-tests are red on any failure and green otherwise", () => {
    const unit = (failed: number) => renderBadges({ ...allGreen, unit: { total: 100, failed, skipped: 0 } })["unit-tests"];
    const e2e = (failed: number) => renderBadges({ ...allGreen, e2e: { passed: 10, failed, skipped: 0 } })["e2e-tests"];
    expect(unit(0)).toMatchObject({ color: "brightgreen", message: "100 passed" });
    expect(unit(1)).toMatchObject({ color: "red", message: "1 failed, 99 passed" });
    expect(e2e(0)).toMatchObject({ color: "brightgreen", message: "10 passed" });
    expect(e2e(3)).toMatchObject({ color: "red", message: "3 failed, 10 passed" });
    expect(renderBadges(allGreen)["unit-tests"].message).toBe("96 passed, 4 skipped");
  });

  it("mutation is judged against mutationScoreMin: at it yellow, +5 green, below red", () => {
    const at = (mutation: number, min = 80) => renderBadges({ ...allGreen, mutation, ratchet: { ...ratchet, mutationScoreMin: min } }).mutation;
    expect(at(80).color).toBe("yellow");
    expect(at(85).color).toBe("brightgreen");
    expect(at(79.99).color).toBe("red");
    expect(at(90, 90).color).toBe("yellow");
    expect(at(89, 90).color).toBe("red");
    expect(at(93.2234).message).toBe("93.22%");
  });
});

describe("input parsers", () => {
  it("mutationScoreOf scores Killed and Timeout against Survived and NoCoverage over every file", () => {
    const report = {
      files: {
        "a.ts": { mutants: [{ status: "Killed" }, { status: "Survived" }, { status: "Ignored" }] },
        "b.ts": { mutants: [{ status: "Timeout" }, { status: "NoCoverage" }, { status: "CompileError" }] },
      },
    };
    expect(mutationScoreOf(report)).toBe(50);
    expect(mutationScoreOf({ files: {} })).toBeNull();
  });

  it("parseAuditCounts reads npm audit's metadata.vulnerabilities and rejects other JSON", () => {
    const text = JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 2, moderate: 1, high: 0, critical: 0, total: 99 } } });
    expect(parseAuditCounts(text)).toEqual({ info: 0, low: 2, moderate: 1, high: 0, critical: 0, total: 3 });
    expect(() => parseAuditCounts("{}")).toThrow("audit JSON has no metadata.vulnerabilities");
  });

  it("parseRatchetInput reads the thresholds and rejects a file without them", () => {
    expect(parseRatchetInput(JSON.stringify(ratchet))).toEqual(ratchet);
    expect(() => parseRatchetInput("{}")).toThrow(".ratchet.json has no coverageThresholds");
  });
});

describe("static badges come from package.json", () => {
  const repoPackage = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as {
    license: string;
    devDependencies: { electron: string };
    engines: { node: string };
  };
  const firstNumber = (range: string) => /\d+/.exec(range)![0];

  it("reads the license, the Electron major and the Node major of this repository's package.json", () => {
    const badges = staticBadges(repoPackage);
    expect(badges.license).toEqual({ ...SHAPE, label: "license", message: repoPackage.license });
    expect(badges.electron).toEqual({ ...SHAPE, label: "electron", message: firstNumber(repoPackage.devDependencies.electron) });
    expect(badges.node).toEqual({ ...SHAPE, label: "node", message: firstNumber(repoPackage.engines.node) });
  });

  it("changes with a fixture package.json that names other versions", () => {
    const fixture = { license: "Apache-2.0", devDependencies: { electron: "^55.2.1" }, engines: { node: ">=26.1.0" } };
    const badges = staticBadges(fixture);
    expect(badges.license.message).toBe("Apache-2.0");
    expect(badges.electron.message).toBe("55");
    expect(badges.node.message).toBe("26");
    expect(badges.license.message).not.toBe(repoPackage.license);
  });

  it("falls back to n/a lightgrey when package.json does not name them", () => {
    for (const pkg of [{}, null, { license: 1, devDependencies: { electron: 3 }, engines: {} }]) {
      for (const badge of Object.values(staticBadges(pkg))) expect(badge).toMatchObject({ message: "n/a", color: "lightgrey" });
    }
  });
});

describe("parseEslintCounts", () => {
  const file = (errorCount: number, warningCount: number) => ({ filePath: "x.ts", messages: [], errorCount, fatalErrorCount: 0, warningCount });
  it("sums the error and warning counts over every file", () => {
    expect(parseEslintCounts(JSON.stringify([file(0, 2), file(1, 0), file(0, 3)]))).toEqual({ errors: 1, warnings: 5 });
  });
  it("reads an empty result as zero and zero", () => {
    expect(parseEslintCounts("[]")).toEqual({ errors: 0, warnings: 0 });
  });
  it("rejects output that is not an ESLint result", () => {
    expect(() => parseEslintCounts("{}")).toThrow(/array/);
    expect(() => parseEslintCounts("[{}]")).toThrow(/errorCount/);
    expect(() => parseEslintCounts("[null]")).toThrow(/errorCount/);
    expect(() => parseEslintCounts("nope")).toThrow();
  });
});

describe("badges CLI", () => {
  const cli = path.resolve(__dirname, "../../scripts/badges/render.ts");
  const run = (dir: string, args: string[]) =>
    spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", cli, ...args], { cwd: dir, encoding: "utf8" });
  const put = (dir: string, file: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };
  const readOut = (out: string, name: string) => JSON.parse(readFileSync(path.join(out, `${name}.json`), "utf8"));
  let root: string;
  let full: ReturnType<typeof run>;
  let empty: ReturnType<typeof run>;
  let bad: ReturnType<typeof run>;
  let usage: ReturnType<typeof run>;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "badges-cli-"));
    const populated = path.join(root, "populated");
    put(populated, ".ratchet.json", JSON.stringify(ratchet));
    const total = (pct: number) => ({ total: 10, covered: 9, skipped: 0, pct });
    put(populated, "coverage/coverage-summary.json", JSON.stringify({ total: { lines: total(84), statements: total(88), functions: total(70), branches: total(74) } }));
    put(populated, "coverage/crap-summary.json", JSON.stringify({ max: 30, functions: 5, over: 0 }));
    put(populated, "junit/junit.xml", '<testsuites tests="10" failures="1" errors="0" skipped="2"></testsuites>');
    put(populated, "test-results/shard1.json", JSON.stringify({ stats: { expected: 4, unexpected: 0, flaky: 0, skipped: 1 } }));
    put(populated, "test-results/shard2.json", JSON.stringify({ stats: { expected: 5, unexpected: 0, flaky: 1, skipped: 0 } }));
    put(populated, "reports/mutation/mutation.json", JSON.stringify({ files: { "a.ts": { mutants: [{ status: "Killed" }, { status: "Survived" }] } } }));
    put(populated, "reports/eslint.json", JSON.stringify([{ errorCount: 0, warningCount: 2 }, { errorCount: 0, warningCount: 1 }]));
    put(populated, "custom/lint.json", JSON.stringify([{ errorCount: 0, warningCount: 0 }]));
    put(populated, "reports/audit.json", JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 2, moderate: 0, high: 0, critical: 0, total: 2 } } }));
    full = run(populated, ["--out", "out", "--e2e", "test-results/shard1.json", "--e2e", "test-results/shard2.json"]);
    const blank = path.join(root, "blank");
    mkdirSync(blank);
    empty = run(blank, ["--out", "nested/out"]);
    const broken = path.join(root, "broken");
    put(broken, ".ratchet.json", "{not json");
    bad = run(broken, ["--out", "out"]);
    usage = run(blank, []);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("writes exactly the 10 endpoint files with the colours the inputs dictate", () => {
    expect(full.status).toBe(0);
    const out = path.join(root, "populated/out");
    expect(readdirSync(out).sort()).toEqual(BADGE_NAMES.map((name) => `${name}.json`).sort());
    expect(readOut(out, "coverage-lines")).toEqual({ schemaVersion: 1, label: "coverage lines", message: "84%", color: "yellow" });
    expect(readOut(out, "coverage-statements").color).toBe("brightgreen");
    expect(readOut(out, "coverage-functions").color).toBe("red");
    expect(readOut(out, "coverage-branches").color).toBe("yellow");
    expect(readOut(out, "crap").color).toBe("brightgreen");
    expect(readOut(out, "lint")).toEqual({ schemaVersion: 1, label: "lint", message: "3 warnings", color: "yellow" });
    expect(readOut(out, "unit-tests")).toMatchObject({ color: "red", message: "1 failed, 7 passed, 2 skipped" });
    expect(readOut(out, "e2e-tests")).toMatchObject({ color: "brightgreen", message: "10 passed, 1 skipped" });
    expect(readOut(out, "mutation")).toMatchObject({ color: "red", message: "50%" });
    expect(readOut(out, "audit")).toEqual({ schemaVersion: 1, label: "audit", message: "0 high+ vulnerabilities", color: "brightgreen" });
  });

  it("writes n/a lightgrey badges, creating the directory, when no report exists", () => {
    expect(empty.status).toBe(0);
    const out = path.join(root, "blank/nested/out");
    expect(readdirSync(out)).toHaveLength(10);
    for (const name of BADGE_NAMES) expect(readOut(out, name)).toMatchObject({ schemaVersion: 1, message: "n/a", color: "lightgrey" });
  });

  it("reads the ESLint result from --eslint, and never the .ratchet.json ceiling", () => {
    const dir = path.join(root, "populated");
    expect(run(dir, ["--out", "out-custom", "--eslint", "custom/lint.json"]).status).toBe(0);
    expect(readOut(path.join(dir, "out-custom"), "lint")).toMatchObject({ message: "0 warnings", color: "brightgreen" });
    expect(run(dir, ["--out", "out-missing", "--eslint", "custom/absent.json"]).status).toBe(0);
    expect(readOut(path.join(dir, "out-missing"), "lint")).toEqual({ schemaVersion: 1, label: "lint", message: "n/a", color: "lightgrey" });
    const ratchetOnly = path.join(root, "ratchet-only");
    put(ratchetOnly, ".ratchet.json", JSON.stringify(ratchet));
    expect(run(ratchetOnly, ["--out", "out"]).status).toBe(0);
    expect(readOut(path.join(ratchetOnly, "out"), "lint").message).toBe("n/a");
    expect(readOut(path.join(ratchetOnly, "out"), "crap").message).toBe("n/a");
  });

  it("publishes the mutation badge n/a lightgrey, never a green, when its report is absent, unreadable or has no scoreable mutant", () => {
    const cases: Record<string, string | null> = {
      absent: null,
      truncated: '{"files": {"a.ts": {"mutan',
      "no files key": "{}",
      "empty files": JSON.stringify({ files: {} }),
      "only ignored mutants": JSON.stringify({ files: { "a.ts": { mutants: [{ status: "Ignored" }, { status: "CompileError" }] } } }),
    };
    for (const [name, report] of Object.entries(cases)) {
      const dir = path.join(root, `mutation-${name.replace(/ /g, "-")}`);
      put(dir, ".ratchet.json", JSON.stringify(ratchet));
      if (report !== null) put(dir, "reports/mutation/mutation.json", report);
      expect(run(dir, ["--out", "out", "--mutation", "reports/mutation/mutation.json"]).status, name).toBe(0);
      expect(readOut(path.join(dir, "out"), "mutation"), name).toEqual({ schemaVersion: 1, label: "mutation", message: "n/a", color: "lightgrey" });
    }
  });

  it("keeps the real mutation score when only another input is missing", () => {
    const dir = path.join(root, "populated");
    expect(run(dir, ["--out", "out-no-audit", "--audit", "reports/absent.json"]).status).toBe(0);
    expect(readOut(path.join(dir, "out-no-audit"), "audit").message).toBe("n/a");
    expect(readOut(path.join(dir, "out-no-audit"), "mutation")).toMatchObject({ message: "50%", color: "red" });
  });

  it("treats an unreadable input as missing and says so on stderr", () => {
    expect(bad.status).toBe(0);
    expect(bad.stderr).toContain("badges: .ratchet.json:");
    expect(readOut(path.join(root, "broken/out"), "lint").message).toBe("n/a");
    const garbled = path.join(root, "garbled");
    put(garbled, "reports/eslint.json", "{\"not\": \"an array\"}");
    const result = run(garbled, ["--out", "out"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("badges: reports/eslint.json:");
    expect(readOut(path.join(garbled, "out"), "lint")).toMatchObject({ message: "n/a", color: "lightgrey" });
  });

  it("renders e2e-tests n/a, never a green partial sum, when any named shard file is absent or unreadable", () => {
    const dir = path.join(root, "populated");
    const e2e = (name: string, args: string[]) => {
      expect(run(dir, ["--out", name, ...args]).status).toBe(0);
      return readOut(path.join(dir, name), "e2e-tests");
    };
    const na = { schemaVersion: 1, label: "e2e tests", message: "n/a", color: "lightgrey" };
    // shard 2 never arrived
    expect(e2e("out-no2", ["--e2e", "test-results/shard1.json", "--e2e", "test-results/absent.json"])).toEqual(na);
    // shard 1 never arrived
    expect(e2e("out-no1", ["--e2e", "test-results/absent.json", "--e2e", "test-results/shard2.json"])).toEqual(na);
    // both missing
    expect(e2e("out-none", ["--e2e", "test-results/absent1.json", "--e2e", "test-results/absent2.json"])).toEqual(na);
    // a shard file that is not Playwright JSON
    put(dir, "test-results/garbled.json", "{not json");
    expect(e2e("out-garbled", ["--e2e", "test-results/shard1.json", "--e2e", "test-results/garbled.json"])).toEqual(na);
    // both present still sum
    expect(e2e("out-both", ["--e2e", "test-results/shard1.json", "--e2e", "test-results/shard2.json"])).toMatchObject({ color: "brightgreen" });
  });

  it("exits 2 with usage when --out is missing", () => {
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain("usage: badges.ts --out <dir>");
  });
});
