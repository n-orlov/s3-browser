import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BADGE_NAMES } from "../../scripts/badges/badges";
import {
  BLOCK_END,
  BLOCK_START,
  WORKFLOW_BADGES,
  metricJsonUrl,
  readmeBadgeBlock,
  replaceBadgeBlock,
} from "../../scripts/badges/readmeBlock";

const root = path.resolve(__dirname, "..", "..");
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as unknown;

/** The committed block, markers included, as found in a README text. */
function blockOf(text: string): string {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  return start === -1 || end === -1 ? "" : text.slice(start, end + BLOCK_END.length);
}

/** The drift check: the README's block must equal the generator output. */
const isInSync = (text: string): boolean => blockOf(text) === readmeBadgeBlock(pkg);

describe("README badge block", () => {
  it("equals the generator output", () => {
    expect(blockOf(readme)).toBe(readmeBadgeBlock(pkg));
    expect(isInSync(readme)).toBe(true);
  });

  it("sits at the top of the README, right after the title", () => {
    expect(readme.indexOf(BLOCK_START)).toBeLessThan(readme.indexOf("## Background"));
    expect(readme.split("\n")[0]).toBe("# S3 Browser");
  });

  it("has a workflow badge (branch=master, linking to its workflow page) for ci, codeql, mutation and e2e-soak", () => {
    expect(WORKFLOW_BADGES.map((w) => w.file)).toEqual(["ci.yml", "codeql.yml", "mutation.yml", "e2e-soak.yml"]);
    const block = blockOf(readme);
    const badges = [...block.matchAll(/\]\(https:\/\/github\.com\/n-orlov\/s3-browser\/actions\/workflows\/([\w.-]+)\/badge\.svg\?branch=master\)\]\(([^)]+)\)/g)];
    expect(badges.map((m) => m[1])).toEqual(WORKFLOW_BADGES.map((w) => w.file));
    for (const [, file, link] of badges) {
      expect(existsSync(path.join(root, ".github", "workflows", file)), file).toBe(true);
      expect(link).toBe(`https://github.com/n-orlov/s3-browser/actions/workflows/${file}`);
    }
  });

  it("has an endpoint badge for each of the 10 metric files the renderer emits, and no other", () => {
    const urls = [...blockOf(readme).matchAll(/img\.shields\.io\/endpoint\?url=([^)]+)\)/g)].map((m) =>
      decodeURIComponent(m[1]),
    );
    const names = urls.map((url) => {
      const found = /^https:\/\/n-orlov\.github\.io\/s3-browser\/badges\/([\w-]+)\.json$/.exec(url);
      expect(found, url).not.toBeNull();
      return found![1];
    });
    expect(names).toHaveLength(10);
    for (const name of names) expect(BADGE_NAMES as readonly string[], name).toContain(name);
    expect([...names].sort()).toEqual([...BADGE_NAMES].sort());
    expect(urls).toEqual(BADGE_NAMES.map(metricJsonUrl));
  });

  it("has the license, Electron and Node static badges and an Allure report link badge", () => {
    const block = blockOf(readme);
    expect(block).toContain("img.shields.io/badge/license-MIT-blue");
    expect(block).toMatch(/img\.shields\.io\/badge\/electron-\d+-blue/);
    expect(block).toMatch(/img\.shields\.io\/badge\/node-%3E%3D\d+-blue/);
    expect(block).toContain("[![Allure report](https://img.shields.io/badge/Allure-report-blue)](https://n-orlov.github.io/s3-browser/)");
  });
});

describe("README badge drift check", () => {
  it("fails for a README whose block was edited by hand", () => {
    expect(isInSync(readme.replace("badge.svg?branch=master", "badge.svg?branch=main"))).toBe(false);
    expect(isInSync(readme.replace("badges/crap.json", "badges/crapp.json").replace("badges%2Fcrap.json", "badges%2Fcrapp.json"))).toBe(false);
    expect(isInSync(readme.replace(/\[!\[Node\][^\n]*\n/, ""))).toBe(false);
  });

  it("fails for a README without the markers", () => {
    expect(isInSync("# S3 Browser\n")).toBe(false);
    expect(() => replaceBadgeBlock("# S3 Browser\n", "x")).toThrow("no badge block markers");
  });

  it("replaceBadgeBlock rewrites only the block and is idempotent", () => {
    const stale = readme.replace("badge.svg?branch=master", "badge.svg?branch=stale");
    const fixed = replaceBadgeBlock(stale, readmeBadgeBlock(pkg));
    expect(fixed).toBe(readme);
    expect(replaceBadgeBlock(fixed, readmeBadgeBlock(pkg))).toBe(fixed);
    const outside = replaceBadgeBlock(`before\n${BLOCK_START}\nold\n${BLOCK_END}\nafter\n`, "NEW");
    expect(outside).toBe("before\nNEW\nafter\n");
  });

  it("derives the static badges from package.json instead of constants", () => {
    const other = readmeBadgeBlock({ license: "ISC", devDependencies: { electron: "^99.1.0" }, engines: { node: ">=30" } });
    expect(other).toContain("badge/license-ISC-blue");
    expect(other).toContain("badge/electron-99-blue");
    expect(other).toContain("badge/node-%3E%3D30-blue");
  });
});

describe("npm run badges:readme", () => {
  it("rewrites only the block of a README copy in a temp directory, and a second run changes nothing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "readme-badges-"));
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
    const original = `# T\n\n${BLOCK_START}\nstale\n${BLOCK_END}\n\ntext after\n`;
    writeFileSync(path.join(dir, "README.md"), original);
    const script = path.join(root, "scripts", "badges", "readme.ts");
    const run = () => spawnSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script], { cwd: dir, encoding: "utf8" });
    expect(run().status).toBe(0);
    const once = readFileSync(path.join(dir, "README.md"), "utf8");
    expect(once).toBe(`# T\n\n${readmeBadgeBlock(pkg)}\n\ntext after\n`);
    expect(run().status).toBe(0);
    expect(readFileSync(path.join(dir, "README.md"), "utf8")).toBe(once);
  });

  it("exits 2 when README.md has no markers", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "readme-badges-"));
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
    writeFileSync(path.join(dir, "README.md"), "# T\n");
    const script = path.join(root, "scripts", "badges", "readme.ts");
    const result = spawnSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no badge block markers");
  });
});
