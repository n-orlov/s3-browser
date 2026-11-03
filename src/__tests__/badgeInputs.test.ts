// The pure helpers the Jenkins embeddable badges and the README badge row share (scripts/badges/badges.ts).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { colorForThreshold, mutationScoreOf, parseEslintCounts, parseRatchetInput, staticBadges } from "../../scripts/badges/badges";

const ratchet = {
  maxWarnings: 0,
  mutationScoreMin: 80,
  coverageThresholds: { lines: 84, functions: 83, branches: 74, statements: 83 },
};
const SHAPE = { schemaVersion: 1, label: expect.any(String), message: expect.any(String), color: expect.any(String) };

describe("colorForThreshold", () => {
  it("is red below the threshold, yellow at it and green at threshold + 5", () => {
    expect([colorForThreshold(10, 10), colorForThreshold(15, 10), colorForThreshold(9.9, 10)]).toEqual(["yellow", "brightgreen", "red"]);
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
    const fixture = { license: "ISC", devDependencies: { electron: "^55.2.1" }, engines: { node: ">=26.1.0" } };
    const badges = staticBadges(fixture);
    expect(badges.license.message).toBe("ISC");
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

