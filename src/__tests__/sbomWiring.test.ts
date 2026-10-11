import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

const SBOM_PATH = "sbom/sbom.cdx.json";

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };
type Pkg = { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const root = path.resolve(__dirname, "../..");
const readText = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const pkg = JSON.parse(readText("package.json")) as Pkg;

const stepsOf = (wf: Workflow, job: string): Step[] => wf.jobs?.[job]?.steps ?? [];
const withText = (s: Step, key: string): string => String(s.with?.[key] ?? "");

/** One problem per way the package.json deviates from a prod-only CycloneDX SBOM script. */
function scriptProblems(p: Pkg): string[] {
  const problems: string[] = [];
  const script = p.scripts?.sbom;
  if (!script) return ["no `sbom` script"];
  if (!script.includes("cyclonedx-npm")) problems.push("sbom script does not use cyclonedx-npm");
  if (!/--omit[ =]dev|--omit-dev/.test(script)) problems.push("sbom script does not omit dev dependencies");
  if (!script.includes(SBOM_PATH)) problems.push(`sbom script does not write ${SBOM_PATH}`);
  if (!p.devDependencies?.["@cyclonedx/cyclonedx-npm"]) problems.push("cyclonedx-npm is not a devDependency");
  if (p.dependencies?.["@cyclonedx/cyclonedx-npm"]) problems.push("cyclonedx-npm is listed under dependencies");
  return problems;
}

/** One problem per way the CI quality job deviates from generating and always uploading the SBOM. */
function ciProblems(wf: Workflow): string[] {
  const steps = stepsOf(wf, "quality");
  const problems: string[] = [];
  if (!steps.some((s) => s.run?.trim() === "npm run sbom")) problems.push("quality job does not run `npm run sbom`");
  const upload = steps.find((s) => s.uses?.startsWith("actions/upload-artifact@") && withText(s, "path") === SBOM_PATH);
  if (!upload) return [...problems, `quality job has no upload-artifact step for ${SBOM_PATH}`];
  if (!/^actions\/upload-artifact@[0-9a-f]{40}( |$)/.test(upload.uses ?? "")) problems.push("upload-artifact is not pinned by SHA");
  if (upload.if?.replace(/[\s${}]/g, "") !== "always()") problems.push("SBOM upload step lacks `if: always()`");
  return problems;
}

/** One problem per way the release workflow deviates from generating and attaching the SBOM. */
function releaseProblems(wf: Workflow): string[] {
  const steps = Object.keys(wf.jobs ?? {}).flatMap((j) => stepsOf(wf, j));
  const problems: string[] = [];
  if (!steps.some((s) => s.run?.trim() === "npm run sbom")) problems.push("release does not run `npm run sbom`");
  const attach = steps.find((s) => s.uses?.startsWith("softprops/action-gh-release@") && withText(s, "files").split(/\s+/).includes(SBOM_PATH));
  if (!attach) problems.push(`no release attach step lists ${SBOM_PATH} in files`);
  return problems;
}

const ci = parse(readText(".github/workflows/ci.yml")) as Workflow;
const release = parse(readText(".github/workflows/release.yml")) as Workflow;

describe("SBOM wiring", () => {
  it("package.json has a prod-only CycloneDX script and the tool is a devDependency", () => {
    expect(scriptProblems(pkg)).toEqual([]);
  });

  it("ci.yml quality job runs the script and uploads the SBOM with if: always() and a SHA-pinned action", () => {
    expect(ciProblems(ci)).toEqual([]);
  });

  it("release.yml generates the SBOM and attaches its path", () => {
    expect(releaseProblems(release)).toEqual([]);
  });

  it("fails when the upload step loses `if: always()`", () => {
    const broken = structuredClone(ci);
    for (const s of stepsOf(broken, "quality")) {
      if (withText(s, "path") === SBOM_PATH) delete s.if;
    }
    expect(ciProblems(broken)).toContain("SBOM upload step lacks `if: always()`");
  });

  it("fails when the release attach step no longer lists the SBOM path", () => {
    const broken = structuredClone(release);
    for (const job of Object.keys(broken.jobs ?? {})) {
      for (const s of stepsOf(broken, job)) {
        if (s.with?.files) s.with.files = String(s.with.files).replace(SBOM_PATH, "");
      }
    }
    expect(releaseProblems(broken)).toContain(`no release attach step lists ${SBOM_PATH} in files`);
  });

  it("fails when the tool is under dependencies or the script includes dev dependencies", () => {
    const moved: Pkg = { ...pkg, dependencies: { "@cyclonedx/cyclonedx-npm": "^6.0.1" } };
    expect(scriptProblems(moved)).toContain("cyclonedx-npm is listed under dependencies");
    const noOmit: Pkg = { ...pkg, scripts: { sbom: `cyclonedx-npm --output-file ${SBOM_PATH}` } };
    expect(scriptProblems(noOmit)).toContain("sbom script does not omit dev dependencies");
  });
});
