import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const SBOM_PATH = "sbom/sbom.cdx.json";

type Pkg = {
  engines?: { node?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
type Files = {
  main: string;
  release: string;
  buildScript: string;
  stageScript: string;
};

const root = path.resolve(__dirname, "../..");
const readText = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const pkg = JSON.parse(readText("package.json")) as Pkg;
const real: Files = {
  main: readText("Jenkinsfile"),
  release: readText("Jenkinsfile.release"),
  buildScript: readText("ci/release-build.sh"),
  stageScript: readText("ci/release-stage.sh"),
};

/** The pipeline file with `//` comment lines dropped. */
const codeOf = (text: string): string =>
  text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

/** The body of the first `<head> { ... }` block at or after `from`, by brace matching. */
function blockOf(code: string, head: RegExp, from = 0): string {
  const m = head.exec(code.slice(from));
  if (!m) return "";
  const open = from + m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(open + 1, i);
  }
  return "";
}

/** A shell script with its `#` comment lines dropped. */
const shellCode = (text: string): string =>
  text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

const stageOf = (code: string, name: string): string =>
  blockOf(code, new RegExp(`stage\\('${name}'\\)\\s*\\{`));

/** One problem per way the package.json deviates from a prod-only CycloneDX SBOM script. */
function scriptProblems(p: Pkg): string[] {
  const problems: string[] = [];
  const script = p.scripts?.sbom;
  if (!script) return ["no `sbom` script"];
  if (!script.includes("cyclonedx-npm"))
    problems.push("sbom script does not use cyclonedx-npm");
  if (!/--omit[ =]dev|--omit-dev/.test(script))
    problems.push("sbom script does not omit dev dependencies");
  if (!script.includes(SBOM_PATH))
    problems.push(`sbom script does not write ${SBOM_PATH}`);
  if (!p.devDependencies?.["@cyclonedx/cyclonedx-npm"])
    problems.push("cyclonedx-npm is not a devDependency");
  if (p.dependencies?.["@cyclonedx/cyclonedx-npm"])
    problems.push("cyclonedx-npm is listed under dependencies");
  return problems;
}

/** One problem per way the CI Jenkinsfile deviates from generating the SBOM in Quality and always keeping it. */
function ciProblems(main: string): string[] {
  const code = codeOf(main);
  const quality = stageOf(code, "Quality");
  const problems: string[] = [];
  if (!/nodeSh\('npm run sbom'\)/.test(quality))
    problems.push("Quality does not run `npm run sbom`");
  const stash = /stash name: 'quality-results'[^\n]*\n[^\n]*includes: '([^']*)'/.exec(
    blockOf(quality, /\bpost\s*\{/),
  );
  if (!/\bsbom\/\*\*/.test(stash?.[1] ?? ""))
    problems.push("Quality post { always } does not stash sbom/**");
  const pipelinePost = blockOf(
    code,
    /^ {2}post\s*\{/m,
  );
  const archive = /archiveArtifacts artifacts: '([^']*)'/.exec(
    blockOf(pipelinePost, /\balways\s*\{/),
  );
  if (!/\bsbom\/\*\*/.test(archive?.[1] ?? ""))
    problems.push("pipeline post { always } does not archive sbom/**");
  return problems;
}

/** One problem per way the release flow deviates from building the SBOM and attaching it to the draft. */
function releaseProblems(f: Files): string[] {
  const problems: string[] = [];
  if (!stageOf(codeOf(f.release), "Build").includes("ci/release-build.sh"))
    problems.push("Jenkinsfile.release Build does not run ci/release-build.sh");
  const build = shellCode(f.buildScript);
  if (!/npm run sbom/.test(build))
    problems.push("ci/release-build.sh does not run `npm run sbom`");
  if (!/"\$WORK\/linux\/sbom\.cdx\.json" "\$OUT\/"/.test(build.replace(/\\\n/g, " ")))
    problems.push("ci/release-build.sh does not copy sbom.cdx.json to the output");
  if (!/for f in [^\n]*"\$SBOM"/.test(shellCode(f.stageScript)))
    problems.push("ci/release-stage.sh does not upload the SBOM to the draft");
  if (!/expected="[^"]*\bsbom\.cdx\.json\b/.test(f.stageScript))
    problems.push("ci/release-stage.sh verify does not expect sbom.cdx.json");
  return problems;
}

/** Major of the lowest Node a `>=N` / `N.x` / `N` spec admits. */
const nodeMajor = (spec: string | undefined): number =>
  Number(/(\d+)/.exec(spec ?? "")?.[1] ?? Number.NaN);

/** One problem per node image the CI files run commands in that is older than package.json's `engines.node`, and per Jenkinsfile that sbom-generates before the unit tests. */
function nodeProblems(f: Files, p: Pkg): string[] {
  const required = nodeMajor(p.engines?.node);
  if (Number.isNaN(required)) return ["package.json has no engines.node"];
  const problems: string[] = [];
  const images: [string, string[]][] = [
    ["Jenkinsfile", [...codeOf(f.main).matchAll(/\bnode:(\d+)/g)].map((m) => m[1])],
    [
      "ci/release-build.sh",
      [...f.buildScript.matchAll(/NODE_IMAGE:-node:(\d+)/g)].map((m) => m[1]),
    ],
  ];
  for (const [file, majors] of images) {
    if (majors.length === 0) problems.push(`${file} runs no node image`);
    for (const m of majors)
      if (Number(m) < required)
        problems.push(`${file} selects node:${m}, below engines.node ${p.engines?.node}`);
  }
  const quality = stageOf(codeOf(f.main), "Quality");
  const test = quality.indexOf("npm run test:coverage");
  const sbom = quality.indexOf("npm run sbom");
  if (test < 0 || sbom < 0 || test > sbom)
    problems.push("Quality does not run the unit tests before npm run sbom");
  return problems;
}

/** The real files with one edit applied; throws if the edit did not apply. */
function without(file: keyof Files, from: string | RegExp, to: string): Files {
  const out = real[file].replace(from, to);
  if (out === real[file]) throw new Error(`fixture edit ${String(from)} did not apply`);
  return { ...real, [file]: out };
}

describe("SBOM wiring", () => {
  it("package.json has a prod-only CycloneDX script and the tool is a devDependency", () => {
    expect(scriptProblems(pkg)).toEqual([]);
  });

  it("the Jenkinsfile Quality stage runs the script and always stashes and archives the SBOM", () => {
    expect(ciProblems(real.main)).toEqual([]);
  });

  it("the release flow builds the SBOM, uploads it to the draft and verifies it by name", () => {
    expect(releaseProblems(real)).toEqual([]);
  });

  it("fails when Quality no longer stashes the SBOM in post { always }", () => {
    const broken = without("main", "reports/**, sbom/**'", "reports/**'");
    expect(ciProblems(broken.main)).toContain(
      "Quality post { always } does not stash sbom/**",
    );
  });

  it("fails when the pipeline archive no longer lists sbom/**", () => {
    const broken = without("main", "reports/eslint.json, sbom/**,", "reports/eslint.json,");
    expect(ciProblems(broken.main)).toContain(
      "pipeline post { always } does not archive sbom/**",
    );
  });

  it("fails when Quality stops running the SBOM script", () => {
    const broken = without("main", "nodeSh('npm run sbom')", "nodeSh('true')");
    expect(ciProblems(broken.main)).toContain("Quality does not run `npm run sbom`");
  });

  it("fails when the release build does not run the SBOM script or the stage script does not upload it", () => {
    const noBuild = without("buildScript", "npm run build && npm run sbom &&", "npm run build &&");
    expect(releaseProblems(noBuild)).toContain("ci/release-build.sh does not run `npm run sbom`");
    const noCopy = without("buildScript", '"$WORK/linux/sbom.cdx.json" "$OUT/"', '"$OUT/"');
    expect(releaseProblems(noCopy)).toContain(
      "ci/release-build.sh does not copy sbom.cdx.json to the output",
    );
    const noUpload = without("stageScript", '"$DIST"/*.exe "$SBOM"; do', '"$DIST"/*.exe; do');
    expect(releaseProblems(noUpload)).toContain(
      "ci/release-stage.sh does not upload the SBOM to the draft",
    );
    const noExpect = without("stageScript", " sbom.cdx.json\"", '"');
    expect(releaseProblems(noExpect)).toContain(
      "ci/release-stage.sh verify does not expect sbom.cdx.json",
    );
  });

  it("fails when the tool is under dependencies or the script includes dev dependencies", () => {
    const moved: Pkg = { ...pkg, dependencies: { "@cyclonedx/cyclonedx-npm": "^6.0.1" } };
    expect(scriptProblems(moved)).toContain("cyclonedx-npm is listed under dependencies");
    const noOmit: Pkg = { ...pkg, scripts: { sbom: `cyclonedx-npm --output-file ${SBOM_PATH}` } };
    expect(scriptProblems(noOmit)).toContain("sbom script does not omit dev dependencies");
  });

  it("the CI and release files run on a Node at least engines.node, with the unit tests before the SBOM", () => {
    expect(nodeProblems(real, pkg)).toEqual([]);
  });

  it("fails when a file selects a Node below engines.node or Quality tests after the SBOM", () => {
    const old = without("buildScript", "NODE_IMAGE:-node:22", "NODE_IMAGE:-node:20");
    expect(nodeProblems(old, pkg)).toEqual([
      "ci/release-build.sh selects node:20, below engines.node >=22",
    ]);
    const oldMain = { ...real, main: real.main.replace(/node:22/g, "node:20") };
    expect(nodeProblems(oldMain, pkg)).toEqual([
      "Jenkinsfile selects node:20, below engines.node >=22",
    ]);
    const reordered = without(
      "main",
      /( {8}nodeSh\('npm run test:coverage'\)\n)([\s\S]*?)( {8}nodeSh\('npm run sbom'\)\n)/,
      "$2$3$1",
    );
    expect(nodeProblems(reordered, pkg)).toEqual([
      "Quality does not run the unit tests before npm run sbom",
    ]);
  });
});
