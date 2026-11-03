import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

type Workflow = { on?: { pull_request?: { types?: string[] } } };
type Jenkinsfiles = { main: string; release: string };

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), "utf8");
const workflow = (name: string): Workflow =>
  parse(read(`.github/workflows/${name}`)) as Workflow;

const JENKINSFILES: Jenkinsfiles = {
  main: read("Jenkinsfile"),
  release: read("Jenkinsfile.release"),
};

/** The pipeline file with `//` comment lines dropped. */
const codeOf = (text: string): string =>
  text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

/** The body of the first `<head> { ... }` block, by brace matching. */
function blockOf(code: string, head: RegExp): string {
  const m = head.exec(code);
  if (!m) return "";
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(open + 1, i);
  }
  return "";
}

/** The names of the stages directly under the pipeline's `stages { }` (parallel children are not top-level stages). */
function topStages(file: string): string[] {
  const body = blockOf(codeOf(file), /^ {2}stages\s*\{/m);
  const names: string[] = [];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") depth--;
    else if (depth === 0) {
      const m = /^stage\('([^']+)'\)/.exec(body.slice(i));
      if (m) names.push(m[1]);
    }
  }
  return names;
}

/** SPEC section 5 (CI topology) up to the next level-2 heading or the end of the file. */
function sectionFive(spec: string): string {
  const start = spec.search(/^## 5\. /m);
  if (start < 0) return "";
  const rest = spec.slice(start + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? spec.slice(start) : spec.slice(start, start + 1 + next);
}

/** The bullet of section 5 that starts with the given bold label, or "" when absent. */
function bullet(section: string, label: string): string {
  const lines = section.split("\n");
  const i = lines.findIndex((l) => l.startsWith(`- **${label}`));
  return i < 0 ? "" : lines[i];
}

const WORKFLOWS: { file: string; triggerLabel: string; draftLabel: string }[] =
  [{ file: "codeql.yml", triggerLabel: "CodeQL (", draftLabel: "CodeQL (" }];

/** One problem string per drift between SPEC section 5 and the workflow's pull_request types and draft rule. */
function typeProblems(spec: string, file: string, types: string[]): string[] {
  const section = sectionFive(spec);
  const entry = WORKFLOWS.find((w) => w.file === file);
  if (!entry) return [`${file}: not a known workflow`];
  const problems: string[] = [];
  const triggers = bullet(section, entry.triggerLabel);
  if (!triggers)
    problems.push(`${file}: no section 5 bullet "${entry.triggerLabel}"`);
  const listed = (/types: \[([^\]]*)\]/.exec(triggers)?.[1] ?? "")
    .split(",")
    .map((t) => t.trim());
  for (const t of types) {
    if (!listed.includes(t))
      problems.push(`${file}: bullet does not name pull_request type ${t}`);
  }
  const draft = bullet(section, entry.draftLabel);
  if (!/\bdraft\b/.test(draft))
    problems.push(`${file}: bullet does not state the draft rule`);
  return problems;
}

/** One problem string per way SPEC section 5 mishandles the master branch: merges not stated, or main still named. */
function branchProblems(spec: string): string[] {
  const section = sectionFive(spec);
  const problems: string[] = [];
  const merges = bullet(section, "Pushes to `master` are merges.");
  if (!/push to `master` is the squash merge of a pull request/.test(merges)) {
    problems.push(
      "section 5 does not state that a push to `master` is a merge",
    );
  }
  if (/\bmain\b/.test(section)) problems.push("section 5 still names `main`");
  if (/`?master`?\s+or\s+`?main`?/.test(section))
    problems.push("section 5 still says `master` or `main`");
  return problems;
}

/** The release pipeline bullet of section 5, which lists the stages of Jenkinsfile.release. */
const RELEASE_LABEL = "Release pipeline (`Jenkinsfile.release`";

/** The stage names SPEC section 5 describes: each `**Stage `X`**` bullet, plus the stages the release pipeline bullet lists after "Stages, in this order:". */
function specStages(spec: string): string[] {
  const section = sectionFive(spec);
  const names = [...section.matchAll(/^- \*\*Stage `([^`]+)`\*\*/gm)].map(
    (m) => m[1],
  );
  const release = bullet(section, RELEASE_LABEL);
  const listed = /(Stages, in this order:.*?)\. Every GitHub call/s.exec(
    release,
  )?.[1];
  // The list items are the backticked words that follow ": ", ", " or "and "; other code words are inside the parentheses.
  for (const m of (listed ?? "").matchAll(/(?:: |, |and )`([^`]+)`/g)) {
    if (/^[A-Za-z][A-Za-z0-9]*(?: [a-z]+)?$/.test(m[1])) names.push(m[1]);
  }
  return names;
}

/** One problem per stage SPEC section 5 names that neither Jenkinsfile has, and per Jenkinsfile stage section 5 does not describe. */
function stageProblems(spec: string, files: Jenkinsfiles): string[] {
  const described = specStages(spec);
  const actual = [...topStages(files.main), ...topStages(files.release)];
  const problems: string[] = [];
  for (const name of described) {
    if (!actual.includes(name))
      problems.push(
        `SPEC section 5 names stage \`${name}\` that no Jenkinsfile has`,
      );
  }
  for (const name of actual) {
    if (!described.includes(name))
      problems.push(
        `Jenkinsfile stage \`${name}\` is not described in SPEC section 5`,
      );
  }
  return problems;
}

/** SPEC section 4 (Quality gates) up to the next level-2 heading. */
function sectionFour(spec: string): string {
  const start = spec.search(/^## 4\. /m);
  if (start < 0) return "";
  const rest = spec.slice(start + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? spec.slice(start) : spec.slice(start, start + 1 + next);
}

/** The gates SPEC section 4's table documents: the backticked first cell of each row. */
function specGates(spec: string): string[] {
  return [...sectionFour(spec).matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
}

/** The step helper scripts that are not gates themselves: the lint JSON report precedes the lint gate it reports on. */
const NOT_A_GATE = ["lint:report"];

/** The gates the Jenkinsfiles run, as the table's id and the step that runs it: `npm run <script>`, `ci/trivy.sh` and the e2e container script. */
function jenkinsGates(files: Jenkinsfiles): { id: string; step: string }[] {
  const gates: { id: string; step: string }[] = [];
  for (const file of [files.main, files.release]) {
    const code = codeOf(file);
    for (const m of code.matchAll(/nodeSh\('npm run ([a-z][\w:-]*)/g)) {
      if (!NOT_A_GATE.includes(m[1]))
        gates.push({ id: m[1], step: `npm run ${m[1]}` });
    }
    if (/\bsh '(?:[A-Z_]+=\S+ )*ci\/trivy\.sh/.test(code))
      gates.push({ id: "ci/trivy.sh", step: "ci/trivy.sh" });
    if (/scripts\/e2e-docker\.sh/.test(code.replace(/\/\/.*$/gm, "")))
      gates.push({ id: "test:e2e:docker", step: "scripts/e2e-docker.sh" });
  }
  return gates;
}

/** One problem per gate SPEC section 4 documents that no Jenkinsfile runs, and per Jenkinsfile gate section 4 does not document. */
function gateProblems(spec: string, files: Jenkinsfiles): string[] {
  const documented = specGates(spec);
  const run = jenkinsGates(files);
  const problems: string[] = [];
  for (const id of documented) {
    if (!run.some((g) => g.id === id))
      problems.push(`SPEC section 4 documents gate \`${id}\` that no Jenkinsfile runs`);
  }
  for (const g of run) {
    if (!documented.includes(g.id))
      problems.push(`Jenkinsfile gate \`${g.step}\` is absent from SPEC section 4`);
  }
  return [...new Set(problems)];
}

/** The Release pipeline bullet must say the candidate has to be an ancestor of master, and Jenkinsfile.release must check it. */
function releaseProblems(spec: string, files: Jenkinsfiles): string[] {
  const release = bullet(sectionFive(spec), RELEASE_LABEL);
  const problems: string[] = [];
  if (!release) problems.push("no Release pipeline bullet in section 5");
  if (!/ancestor of `master`/.test(release))
    problems.push("Release bullet does not name the ancestor check");
  if (!codeOf(files.release).includes("git merge-base --is-ancestor"))
    problems.push("Jenkinsfile.release does not check the ancestor");
  return problems;
}

describe("SPEC section 5 matches the live workflow triggers", () => {
  const spec = read("SPEC.md");

  for (const w of WORKFLOWS) {
    it(`${w.file}: bullet names every pull_request type and the draft rule`, () => {
      const types = workflow(w.file).on?.pull_request?.types ?? [];
      expect(types.length).toBeGreaterThan(0);
      expect(typeProblems(spec, w.file, types)).toEqual([]);
    });
  }

  it("states that pushes to master are merges and names no main branch", () => {
    expect(branchProblems(spec)).toEqual([]);
  });

  it("the Release pipeline bullet names the ancestor check Jenkinsfile.release runs", () => {
    expect(releaseProblems(spec, JENKINSFILES)).toEqual([]);
  });
});

describe("SPEC sections 4 and 5 match the Jenkinsfiles", () => {
  const spec = read("SPEC.md");

  it("finds the stages of both Jenkinsfiles", () => {
    expect(topStages(JENKINSFILES.main)).toContain("Quality");
    expect(topStages(JENKINSFILES.release)).toContain("Publish");
  });

  it("section 5 names exactly the stages the Jenkinsfiles have", () => {
    expect(stageProblems(spec, JENKINSFILES)).toEqual([]);
  });

  it("section 4 documents exactly the gates the Jenkinsfiles run", () => {
    expect(jenkinsGates(JENKINSFILES).map((g) => g.id)).toContain("crap");
    expect(gateProblems(spec, JENKINSFILES)).toEqual([]);
  });
});

describe("negative fixtures", () => {
  const spec = read("SPEC.md");
  const types = ["opened", "synchronize", "reopened", "ready_for_review"];

  it("stage drift: fails when SPEC section 5 names a stage `Deploy` the Jenkinsfiles lack", () => {
    const broken = spec.replace(
      /^- \*\*Stage `Quality`\*\*/m,
      "- **Stage `Deploy`** (rolls the build out).\n- **Stage `Quality`**",
    );
    expect(broken).not.toBe(spec);
    expect(stageProblems(broken, JENKINSFILES)).toEqual([
      "SPEC section 5 names stage `Deploy` that no Jenkinsfile has",
    ]);
  });

  it("stage drift: fails when the Jenkinsfile stage `Quality` is missing from SPEC section 5", () => {
    const broken = spec.replace(/^- \*\*Stage `Quality`\*\*.*$/m, "");
    expect(broken).not.toBe(spec);
    expect(stageProblems(broken, JENKINSFILES)).toEqual([
      "Jenkinsfile stage `Quality` is not described in SPEC section 5",
    ]);
  });

  it("stage drift: fails when a release pipeline stage is dropped from the Jenkinsfile.release list", () => {
    const broken = spec.replace(
      "`Verify` (`ci/release-stage.sh verify`) and `Publish`",
      "`Publish`",
    );
    expect(broken).not.toBe(spec);
    expect(stageProblems(broken, JENKINSFILES)).toEqual([
      "Jenkinsfile stage `Verify` is not described in SPEC section 5",
    ]);
  });

  it("gate mismatch: fails when SPEC section 4 documents a gate `License scan` neither Jenkinsfile runs", () => {
    const broken = spec.replace(
      /^(\| `crap` \|.*)$/m,
      "$1\n| `License scan` | `ci/license-scan.sh` | Fails on a copyleft license. |",
    );
    expect(broken).not.toBe(spec);
    expect(gateProblems(broken, JENKINSFILES)).toEqual([
      "SPEC section 4 documents gate `License scan` that no Jenkinsfile runs",
    ]);
  });

  it("gate mismatch: fails when the Jenkinsfile gate `npm run crap` is absent from SPEC section 4", () => {
    const broken = spec.replace(/^\| `crap` \|.*\n/m, "");
    expect(broken).not.toBe(spec);
    expect(gateProblems(broken, JENKINSFILES)).toEqual([
      "Jenkinsfile gate `npm run crap` is absent from SPEC section 4",
    ]);
  });

  it("gate mismatch: fails when a Jenkinsfile stops running a documented gate", () => {
    const broken = {
      ...JENKINSFILES,
      main: JENKINSFILES.main.replace("nodeSh('npm run audit:prod')", "nodeSh('true')"),
    };
    expect(broken.main).not.toBe(JENKINSFILES.main);
    expect(gateProblems(spec, broken)).toEqual([
      "SPEC section 4 documents gate `audit:prod` that no Jenkinsfile runs",
    ]);
  });

  it("fails when a types value is absent from the SPEC bullet", () => {
    const broken = spec.replace(
      /^(- \*\*CodeQL \(.*types: \[opened, synchronize, reopened, )ready_for_review\]/m,
      "$1]",
    );
    expect(broken).not.toBe(spec);
    expect(typeProblems(broken, "codeql.yml", types)).toContain(
      "codeql.yml: bullet does not name pull_request type ready_for_review",
    );
  });

  it("fails when the draft rule is missing from the CodeQL bullet", () => {
    const broken = spec.replace(
      /^- \*\*CodeQL \(.*$/m,
      "- **CodeQL (`.github/workflows/codeql.yml`).** Nothing.",
    );
    expect(broken).not.toBe(spec);
    expect(typeProblems(broken, "codeql.yml", types)).toContain(
      "codeql.yml: bullet does not state the draft rule",
    );
  });

  it("fails when a SPEC fixture still says `master` or `main`", () => {
    const broken = spec.replace(
      "`pull_request` targeting `master` with",
      "`pull_request` targeting `master` or `main` with",
    );
    expect(broken).not.toBe(spec);
    expect(branchProblems(broken)).toContain(
      "section 5 still says `master` or `main`",
    );
  });

  it("fails when the merge statement is gone", () => {
    const broken = spec.replace(
      /^- \*\*Pushes to `master` are merges\.\*\*.*$/m,
      "",
    );
    expect(branchProblems(broken)).toContain(
      "section 5 does not state that a push to `master` is a merge",
    );
  });

  it("fails when the Release bullet loses the ancestor check or Jenkinsfile.release drops it", () => {
    const broken = spec.replace(/ancestor of `master`/g, "descendant of `master`");
    expect(releaseProblems(broken, JENKINSFILES)).toContain(
      "Release bullet does not name the ancestor check",
    );
    const noCheck = {
      ...JENKINSFILES,
      release: JENKINSFILES.release.replace("git merge-base --is-ancestor", "git log"),
    };
    expect(releaseProblems(spec, noCheck)).toContain(
      "Jenkinsfile.release does not check the ancestor",
    );
  });
});
