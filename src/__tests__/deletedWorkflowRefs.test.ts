// R5: the four GitHub workflows that Jenkins replaced are gone, and no test names them again. The file names are
// assembled from parts so that this file does not itself contain the strings it forbids.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const DELETED = ["ci", "e2e-soak", "mutation", "release"].map((stem) => [stem, "yml"].join("."));

/** The files under `dir`/`subdir` (tracked or not) that contain one of the deleted workflow file names, via `git grep -l`. */
function filesNaming(dir: string, subdir: string): string[] {
  const result = spawnSync("git", ["grep", "--no-index", "-l", "-F", ...DELETED.flatMap((name) => ["-e", name]), "--", subdir], {
    cwd: dir,
    encoding: "utf8",
  });
  if (result.status !== 0 && result.status !== 1) throw new Error(`git grep failed: ${result.stderr}`);
  return result.stdout.split("\n").filter(Boolean).sort();
}

describe("the retired GitHub workflows", () => {
  it("are deleted: .github/workflows holds only the CodeQL and macOS workflows", () => {
    for (const name of DELETED) expect(existsSync(path.join(root, ".github/workflows", name)), name).toBe(false);
  });

  it("are named by no file under src/__tests__ (git grep -l finds nothing)", () => {
    expect(filesNaming(root, "src/__tests__")).toEqual([]);
  });

  it.each(DELETED)("is found again when a test file refers to %s", (name) => {
    const dir = mkdtempSync(path.join(tmpdir(), "deleted-workflow-refs-"));
    try {
      mkdirSync(path.join(dir, "src/__tests__"), { recursive: true });
      writeFileSync(path.join(dir, "src/__tests__/clean.test.ts"), "export {};\n");
      expect(filesNaming(dir, "src/__tests__")).toEqual([]);
      writeFileSync(path.join(dir, "src/__tests__/fixture.test.ts"), `readFileSync(".github/workflows/${name}");\n`);
      expect(filesNaming(dir, "src/__tests__")).toEqual(["src/__tests__/fixture.test.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
