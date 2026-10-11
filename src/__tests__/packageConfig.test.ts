import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

type Target = string | { target: string };
type BuildConfig = {
  files?: string[];
  win?: { target?: Target[] };
  linux?: { target?: Target[] };
};
type Step = { uses?: string; with?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

const root = path.resolve(__dirname, "../..");
const readText = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const build = (JSON.parse(readText("package.json")) as { build: BuildConfig }).build;
const release = parse(readText(".github/workflows/release.yml")) as Workflow;

/** The release-asset glob each electron-builder target produces. */
const TARGET_GLOB: Record<string, string> = {
  AppImage: "release/*.AppImage",
  nsis: "release/*.exe",
  portable: "release/*.exe",
};

/** Every exclusion the packaged app must carry: each is a literal fragment of a negated `files` entry. */
const REQUIRED_EXCLUSIONS: Record<string, string> = {
  "unit tests (__tests__)": "__tests__",
  "unit tests (*.test.*)": "*.test.",
  "e2e": "e2e",
  "coverage": "coverage",
  "source maps (*.map)": "*.map",
  ".env*": ".env*",
  "*.pem": "*.pem",
  "*.key": "*.key",
  "credentials": "credentials",
  ".npmrc": ".npmrc",
};

const targetName = (t: Target): string => (typeof t === "string" ? t : t.target);

function uploadedGlobs(wf: Workflow): string[] {
  return Object.values(wf.jobs ?? {})
    .flatMap((j) => j.steps ?? [])
    .filter((s) => s.uses?.startsWith("softprops/action-gh-release@"))
    .flatMap((s) => String(s.with?.files ?? "").split(/\s+/))
    .filter(Boolean);
}

/** One problem per configured target whose release asset is not uploaded by the workflow. */
function uploadProblems(cfg: BuildConfig, wf: Workflow): string[] {
  const globs = uploadedGlobs(wf);
  const targets = [...(cfg.linux?.target ?? []), ...(cfg.win?.target ?? [])].map(targetName);
  const problems: string[] = [];
  for (const t of targets) {
    const glob = TARGET_GLOB[t];
    if (!glob) problems.push(`target ${t} has no known release glob`);
    else if (!globs.includes(glob)) problems.push(`target ${t} is not uploaded: no step lists ${glob}`);
  }
  return problems;
}

/** One problem per required exclusion that no negated `files` entry carries. */
function exclusionProblems(files: string[] | undefined): string[] {
  const negated = (files ?? []).filter((f) => f.startsWith("!"));
  return Object.entries(REQUIRED_EXCLUSIONS)
    .filter(([, fragment]) => !negated.some((f) => f.includes(fragment)))
    .map(([name]) => `build.files does not exclude ${name}`);
}

describe("package.json build config vs release workflow", () => {
  it("configures the Linux AppImage and Windows nsis + portable targets", () => {
    expect((build.linux?.target ?? []).map(targetName)).toContain("AppImage");
    expect((build.win?.target ?? []).map(targetName)).toEqual(expect.arrayContaining(["nsis", "portable"]));
  });

  it("uploads release/*.AppImage for AppImage and release/*.exe for nsis and portable", () => {
    expect(uploadProblems(build, release)).toEqual([]);
    const globs = uploadedGlobs(release);
    expect(globs).toContain("release/*.AppImage");
    expect(globs).toContain("release/*.exe");
  });

  it("fails when an upload glob does not match a configured target (negative fixture)", () => {
    const mismatched: Workflow = {
      jobs: {
        linux: { steps: [{ uses: "softprops/action-gh-release@abc", with: { files: "release/*.deb" } }] },
        win: { steps: [{ uses: "softprops/action-gh-release@abc", with: { files: "release/*.exe" } }] },
      },
    };
    const problems = uploadProblems(build, mismatched);
    expect(problems).toEqual(["target AppImage is not uploaded: no step lists release/*.AppImage"]);
    expect(uploadProblems({ win: { target: ["msi"] } }, release)).toEqual(["target msi has no known release glob"]);
  });

  it("excludes test, e2e, coverage and source-map paths from the packaged app", () => {
    expect(build.files).toContain("dist/**/*");
    const problems = exclusionProblems(build.files);
    expect(problems).toEqual([]);
  });

  it("excludes credential patterns (.env*, *.pem, *.key, credentials, .npmrc)", () => {
    const negated = (build.files ?? []).filter((f) => f.startsWith("!"));
    for (const fragment of [".env*", "*.pem", "*.key", "credentials", ".npmrc"]) {
      expect(negated.some((f) => f.includes(fragment)), fragment).toBe(true);
    }
  });

  it("fails when files lacks the exclusions (negative fixtures)", () => {
    expect(exclusionProblems(["dist/**/*"])).toHaveLength(Object.keys(REQUIRED_EXCLUSIONS).length);
    expect(exclusionProblems(undefined)).toHaveLength(Object.keys(REQUIRED_EXCLUSIONS).length);
    // a positive (non-negated) entry naming a pattern is an include, not an exclusion
    expect(exclusionProblems(["dist/**/*", "**/*.pem"])).toContain("build.files does not exclude *.pem");
    // dropping a single exclusion is reported by name
    const without = (build.files ?? []).filter((f) => !f.includes("*.map"));
    expect(exclusionProblems(without)).toEqual(["build.files does not exclude source maps (*.map)"]);
  });
});
