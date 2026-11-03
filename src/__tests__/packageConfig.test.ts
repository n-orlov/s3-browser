import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

type Target = string | { target: string };
type BuildConfig = {
  files?: string[];
  win?: { target?: Target[] };
  linux?: { target?: Target[] };
};
/** The release flow's two scripts: what ci/release-build.sh builds and what ci/release-stage.sh uploads to the draft. */
type ReleaseScripts = { build: string; stage: string };

const root = path.resolve(__dirname, "../..");
/** A shell script with its `#` comment lines dropped. */
const shellCode = (text: string): string =>
  text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
const readText = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const build = (JSON.parse(readText("package.json")) as { build: BuildConfig }).build;
const release: ReleaseScripts = {
  build: shellCode(readText("ci/release-build.sh")),
  stage: shellCode(readText("ci/release-stage.sh")),
};

/** The release-asset glob each electron-builder target produces. */
const TARGET_GLOB: Record<string, string> = {
  AppImage: "*.AppImage",
  nsis: "*.exe",
  portable: "*.exe",
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

/** The globs `ci/release-stage.sh` uploads from the build output directory (its `"$DIST"/<glob>` words). */
function uploadedGlobs(r: ReleaseScripts): string[] {
  return [...r.stage.matchAll(/"\$DIST"\/(\*\.\w+)/g)].map((m) => m[1]);
}

/** One problem per configured target that `ci/release-build.sh` does not build or `ci/release-stage.sh` does not upload. */
function uploadProblems(cfg: BuildConfig, r: ReleaseScripts): string[] {
  const globs = uploadedGlobs(r);
  const targets = [...(cfg.linux?.target ?? []), ...(cfg.win?.target ?? [])].map(targetName);
  const problems: string[] = [];
  for (const t of targets) {
    const glob = TARGET_GLOB[t];
    if (!glob) {
      problems.push(`target ${t} has no known release glob`);
      continue;
    }
    if (!new RegExp(`electron-builder [^\\n']*\\b${t}\\b`).test(r.build))
      problems.push(`target ${t} is not built: ci/release-build.sh does not pass it to electron-builder`);
    if (!globs.includes(glob)) problems.push(`target ${t} is not uploaded: no step lists ${glob}`);
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

describe("package.json build config vs the release scripts", () => {
  it("configures the Linux AppImage and Windows nsis + portable targets", () => {
    expect((build.linux?.target ?? []).map(targetName)).toContain("AppImage");
    expect((build.win?.target ?? []).map(targetName)).toEqual(expect.arrayContaining(["nsis", "portable"]));
  });

  it("builds and uploads *.AppImage for AppImage and *.exe for nsis and portable", () => {
    expect(uploadProblems(build, release)).toEqual([]);
    const globs = uploadedGlobs(release);
    expect(globs).toContain("*.AppImage");
    expect(globs).toContain("*.exe");
  });

  it("fails when an upload glob does not match a configured target (negative fixture)", () => {
    const mismatched: ReleaseScripts = {
      build: release.build,
      stage: release.stage.replaceAll('"$DIST"/*.AppImage', '"$DIST"/*.deb'),
    };
    expect(mismatched.stage).not.toBe(release.stage);
    expect(uploadProblems(build, mismatched)).toEqual(["target AppImage is not uploaded: no step lists *.AppImage"]);
    expect(uploadProblems({ win: { target: ["msi"] } }, release)).toEqual(["target msi has no known release glob"]);
  });

  it("fails when the build script does not build a configured target (negative fixture)", () => {
    const noPortable: ReleaseScripts = {
      build: release.build.replace("--win nsis portable", "--win nsis"),
      stage: release.stage,
    };
    expect(noPortable.build).not.toBe(release.build);
    expect(uploadProblems(build, noPortable)).toEqual([
      "target portable is not built: ci/release-build.sh does not pass it to electron-builder",
    ]);
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

describe("package version", () => {
  it("is exactly 0.20.0 in package.json and package-lock.json", () => {
    const pkg = JSON.parse(readText("package.json")) as { version: string };
    const lock = JSON.parse(readText("package-lock.json")) as { version: string; packages: Record<string, { version: string }> };
    expect(pkg.version).toBe("0.20.0");
    expect(lock.version).toBe("0.20.0");
    expect(lock.packages[""].version).toBe("0.20.0");
  });
});

const MIN_ELECTRON = "44.9.1";

/** True when dotted numeric version `a` is at least `b`. */
function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return true;
}

/** Lowest version a caret/tilde/exact range such as ^44.10.1 admits. */
const rangeFloor = (range: string): string => range.replace(/^[\^~>=\s]+/, "");

describe("electron security floor", () => {
  it("locks node_modules/electron to 44.9.1 or later", () => {
    const lock = JSON.parse(readText("package-lock.json")) as { packages: Record<string, { version: string }> };
    expect(versionAtLeast(lock.packages["node_modules/electron"].version, MIN_ELECTRON)).toBe(true);
  });

  it("declares an electron range that excludes versions below 44.9.1", () => {
    const pkg = JSON.parse(readText("package.json")) as { devDependencies: Record<string, string> };
    expect(versionAtLeast(rangeFloor(pkg.devDependencies.electron), MIN_ELECTRON)).toBe(true);
  });

  it("rejects the vulnerable 44.7.2 (negative fixture)", () => {
    expect(versionAtLeast("44.7.2", MIN_ELECTRON)).toBe(false);
    expect(versionAtLeast(rangeFloor("^44.7.2"), MIN_ELECTRON)).toBe(false);
    expect(versionAtLeast("44.9.1", MIN_ELECTRON)).toBe(true);
    expect(versionAtLeast("45.0.0", MIN_ELECTRON)).toBe(true);
  });
});
