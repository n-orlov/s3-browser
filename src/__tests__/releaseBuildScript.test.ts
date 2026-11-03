import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

const SCRIPT_PATH = path.resolve(__dirname, "../../ci/release-build.sh");
const REAL = readFileSync(SCRIPT_PATH, "utf8");

/** The script without comment lines, so a word in a comment cannot satisfy a rule. */
function code(script: string): string[] {
  return script.split("\n").filter((l) => !/^\s*#/.test(l));
}

/** Every way ci/release-build.sh can stop building what the release flow uploads; empty means it builds all of it. */
function problems(script: string): string[] {
  const lines = code(script);
  const out: string[] = [];
  const find = (re: RegExp) => lines.findIndex((l) => re.test(l));

  const linux = find(/electron-builder\b.*--linux\b.*AppImage/);
  if (linux < 0) out.push("no electron-builder --linux AppImage build");
  else if (!/--x64\b/.test(lines[linux])) out.push("the AppImage build is not explicit about --x64");

  const smoke = find(/scripts\/smoke-appimage\.sh/);
  if (smoke < 0) out.push("no call to scripts/smoke-appimage.sh");
  else if (linux >= 0 && smoke < linux) out.push("the smoke test runs before the AppImage is built");

  const win = find(/electron-builder\b.*--win\b/);
  if (win < 0) out.push("no electron-builder --win build");
  else {
    if (!/--win\b.*\bnsis\b/.test(lines[win])) out.push("the Windows build does not name the nsis target");
    if (!/--win\b.*\bportable\b/.test(lines[win])) out.push("the Windows build does not name the portable target");
    if (!/--x64\b/.test(lines[win])) out.push("the Windows build is not explicit about --x64");
    if (smoke >= 0 && win < smoke) out.push("the Windows build runs before the smoke test");
  }

  if (find(/npm run sbom\b/) < 0) out.push("no sbom step (npm run sbom)");
  if (!lines.some((l) => /sbom\.cdx\.json/.test(l) && /\bcp\b/.test(l))) out.push("sbom.cdx.json is not collected into the output directory");

  // Every container the script creates has a memory cap, and the smoke container gets one too.
  const creates = lines.filter((l) => /docker create\b/.test(l));
  if (creates.length === 0) out.push("no docker create");
  if (creates.some((l) => !/--memory\b/.test(l))) out.push("a docker create has no --memory cap");
  if (!lines.some((l) => /S3B_SMOKE_DOCKER_ARGS=.*--memory\b/.test(l))) out.push("the smoke container has no --memory cap");

  const collected = lines.filter((l) => /"\$WORK\/(linux|win)\//.test(l)).join("\n");
  for (const f of ["S3 Browser-$VERSION.AppImage", "S3 Browser Setup $VERSION.exe", "S3 Browser $VERSION.exe", "sbom.cdx.json"]) {
    if (!collected.includes(f)) out.push(`the output does not collect ${f}`);
  }
  return out;
}

function without(script: string, re: RegExp): string {
  const edited = script.replace(re, "");
  expect(edited).not.toBe(script);
  return edited;
}

describe("ci/release-build.sh", () => {
  it("passes the bash syntax check", () => {
    expect(spawnSync("bash", ["-n", SCRIPT_PATH], { encoding: "utf8" }).status).toBe(0);
  });

  it("builds the x64 AppImage with an explicit --x64, smoke-tests it, builds the nsis and portable exe, and makes the sbom", () => {
    expect(problems(REAL)).toEqual([]);
  });

  it("builds the AppImage with explicit --x64 and runs the smoke script on exactly that file", () => {
    expect(REAL).toContain("npx electron-builder --linux AppImage --x64 -p never");
    expect(REAL).toMatch(/bash scripts\/smoke-appimage\.sh "\$\{APPIMAGE\[0\]\}"/);
  });

  it("builds the Windows targets nsis and portable through the wine builder image", () => {
    expect(REAL).toContain("electron-builder --win nsis portable --x64 -p never");
    expect(REAL).toContain("electronuserland/builder:wine");
  });

  it("caps the memory of its docker containers and of the smoke container", () => {
    expect(REAL).toMatch(/docker create .*--memory "\$BUILD_MEMORY"/);
    expect(REAL).toContain('S3B_SMOKE_DOCKER_ARGS="--memory $BUILD_MEMORY"');
    expect(REAL).toContain('BUILD_MEMORY="${BUILD_MEMORY:-3g}"');
  });

  it("collects exactly the four release files by electron-builder's names", () => {
    expect(REAL).toContain('"$WORK/linux/S3 Browser-$VERSION.AppImage"');
    expect(REAL).toContain('"$WORK/win/S3 Browser Setup $VERSION.exe"');
    expect(REAL).toContain('"$WORK/win/S3 Browser $VERSION.exe"');
    expect(REAL).toContain('"$WORK/linux/sbom.cdx.json"');
  });

  it("rejects an unknown argument with exit 2 before touching docker", () => {
    const r = spawnSync("bash", [SCRIPT_PATH, "--bogus"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown argument");
  });

  describe("red fixtures", () => {
    it("a script without --x64 on the AppImage build is rejected", () => {
      const s = REAL.replaceAll("--linux AppImage --x64 -p never", "--linux AppImage -p never");
      expect(s).not.toBe(REAL);
      expect(problems(s)).toContain("the AppImage build is not explicit about --x64");
    });

    it("a script without the smoke call is rejected", () => {
      const s = without(REAL, /^\(cd "\$WORK\/src" && S3B_SMOKE.*\n/m);
      expect(problems(s)).toContain("no call to scripts/smoke-appimage.sh");
    });

    it("a script without the portable target is rejected", () => {
      const s = REAL.replaceAll("--win nsis portable --x64", "--win nsis --x64");
      expect(problems(s)).toContain("the Windows build does not name the portable target");
    });

    it("a script without the nsis target is rejected", () => {
      const s = REAL.replaceAll("--win nsis portable --x64", "--win portable --x64");
      expect(problems(s)).toContain("the Windows build does not name the nsis target");
    });

    it("a script without the sbom step is rejected", () => {
      const s = REAL.replace("npm run sbom && ", "");
      expect(problems(s)).toContain("no sbom step (npm run sbom)");
    });

    it("a script whose docker create has no --memory cap is rejected", () => {
      const s = REAL.replace('--memory "$BUILD_MEMORY" ', "");
      expect(problems(s)).toContain("a docker create has no --memory cap");
    });

    it("a script that smoke-tests before it builds the AppImage is rejected", () => {
      const smokeLine = REAL.split("\n").find((l) => l.includes("scripts/smoke-appimage.sh") && l.startsWith("(cd"))!;
      const s = REAL.replace(smokeLine + "\n", "").replace("# 1. Linux:", smokeLine + "\n# 1. Linux:");
      expect(problems(s)).toContain("the smoke test runs before the AppImage is built");
    });
  });
});
