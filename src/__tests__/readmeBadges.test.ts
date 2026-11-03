import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JENKINS_BADGE_IDS } from "../../scripts/badges/jenkinsBadges";
import {
  BLOCK_END,
  BLOCK_START,
  WORKFLOW_BADGES,
  jenkinsBadgeUrl,
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

  it("has a CodeQL workflow badge (branch=master, linking to its workflow page) whose file exists", () => {
    expect(WORKFLOW_BADGES.map((w) => w.file)).toEqual(["codeql.yml"]);
    const block = blockOf(readme);
    const badges = [...block.matchAll(/\]\(https:\/\/github\.com\/n-orlov\/s3-browser\/actions\/workflows\/([\w.-]+)\/badge\.svg\?branch=master\)\]\(([^)]+)\)/g)];
    expect(badges.map((m) => m[1])).toEqual(WORKFLOW_BADGES.map((w) => w.file));
    for (const [, file, link] of badges) {
      expect(existsSync(path.join(root, ".github", "workflows", file)), file).toBe(true);
      expect(link).toBe(`https://github.com/n-orlov/s3-browser/actions/workflows/${file}`);
    }
  });

  it("has the five Jenkins badges build, tests, coverage, quality and mutation, served from jenkins-static for ci/master", () => {
    const ids = ["build", "tests", "coverage", "quality", "mutation"];
    expect([...JENKINS_BADGE_IDS]).toEqual(ids);
    const urls = [...blockOf(readme).matchAll(/!\[[^\]]*\]\((https:\/\/int21h\.mooo\.com\/[^)]+)\)/g)].map((m) => m[1]);
    expect(urls).toEqual(ids.map((id) => `https://int21h.mooo.com/jenkins-static/s3-browser/ci/master/${id}.svg`));
    expect(urls).toEqual(ids.map(jenkinsBadgeUrl));
    const links = [...blockOf(readme).matchAll(/\]\(https:\/\/int21h\.mooo\.com\/[^)]+\)\]\(([^)]+)\)/g)].map((m) => m[1]);
    expect(links).toEqual(ids.map(() => "https://github.com/n-orlov/s3-browser/commits/master"));
  });

  it("has no shields endpoint badge on the old GitHub Pages metric files", () => {
    expect(blockOf(readme)).not.toContain("img.shields.io/endpoint");
    expect(blockOf(readme)).not.toContain("n-orlov.github.io/s3-browser/badges");
  });

  it("has the license, Electron and Node static badges and no Allure report badge (the report lives on Jenkins, not on GitHub Pages)", () => {
    const block = blockOf(readme);
    expect(block).toContain("img.shields.io/badge/license-Apache--2.0-blue");
    const images = [...block.matchAll(/!\[[^\]]*\]\((https:[^)]+)\)/g)].map((m) => m[1]);
    expect(images.filter((url) => /^https:\/\/img\.shields\.io\/badge\/electron-\d+-blue$/.test(url))).toHaveLength(1);
    expect(images.filter((url) => /^https:\/\/img\.shields\.io\/badge\/node-%3E%3D\d+-blue$/.test(url))).toHaveLength(1);
    expect(block).not.toContain("Allure");
  });
});

describe("README CI and release text", () => {
  it("links nothing on n-orlov.github.io and names none of the four deleted workflows or gh-pages", () => {
    expect(readme).not.toContain("n-orlov.github.io");
    // Assembled from parts so this file does not itself name the workflows deletedWorkflowRefs forbids.
    for (const name of ["ci", "release", "e2e-soak", "mutation"].map((stem) => [stem, "yml"].join("."))) {
      expect(readme, name).not.toContain(name);
    }
    expect(readme).not.toContain("gh-pages");
  });

  it("names the Jenkins jobs, the jenkins/gate check and the macOS dispatch workflow", () => {
    for (const name of ["s3-browser/ci", "s3-browser/release", "jenkins/gate", "macos-build.yml"]) {
      expect(readme, name).toContain(name);
    }
    expect(existsSync(path.join(root, ".github", "workflows", "macos-build.yml"))).toBe(true);
  });
});

describe("README badge drift check", () => {
  it("fails for a README whose block was edited by hand", () => {
    expect(isInSync(readme.replace("badge.svg?branch=master", "badge.svg?branch=main"))).toBe(false);
    expect(isInSync(readme.replace("/ci/master/coverage.svg", "/ci/main/coverage.svg"))).toBe(false);
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
