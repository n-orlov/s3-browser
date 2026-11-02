import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/** The script with comment lines dropped and line continuations joined. */
function codeOf(script: string): string {
  return script
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

/** The arguments of the `docker create` that builds the scanner container. */
function scanArgs(script: string): string {
  const m = /docker create\b([^\n]*)/.exec(codeOf(script));
  return m ? m[1].replace(/\s+/g, " ") : "";
}

/** One problem string per property of the Trivy gate the script lacks. */
function trivyGateProblems(script: string): string[] {
  const problems: string[] = [];
  const code = codeOf(script);
  const args = scanArgs(script);
  if (!/(^|\s)fs(\s|$)/.test(args)) problems.push("not in fs mode");
  const scanners = /--scanners[ =](\S+)/.exec(args)?.[1].split(",").sort().join(",");
  if (scanners !== "misconfig,secret,vuln") {
    problems.push(`scanners are ${scanners ?? "unset"}, expected vuln,secret,misconfig`);
  }
  const severity = /--severity[ =](\S+)/.exec(args)?.[1].split(",").sort().join(",");
  if (severity !== "CRITICAL,HIGH") {
    problems.push(`severity is ${severity ?? "unset"}, expected HIGH,CRITICAL`);
  }
  if (!/(^|\s)--include-dev-deps(\s|$)/.test(args)) problems.push("dev dependencies are not scanned");
  if (!/--exit-code[ =]1(\s|$)/.test(args)) problems.push("a finding does not exit 1");
  const freshRemovesDb =
    /--fresh\)\s*fresh=1/.test(code) &&
    /if \[ "\$fresh" = 1 \]; then[\s\S]*rm -rf \/cache\/db[\s\S]*?\bfi\b/.test(code);
  if (!freshRemovesDb) problems.push("no fresh mode that removes the cached DB");
  if (!/--cache-dir \/cache/.test(args) || !/-v "\$VOLUME:\/cache"/.test(args)) {
    problems.push("DB is not cached on the named volume");
  }
  if (!/^IMAGE="aquasec\/trivy:[0-9.]+@sha256:[0-9a-f]{64}"$/m.test(code)) {
    problems.push("Trivy image is not pinned by version and digest");
  }
  return problems;
}

const real = readFileSync(path.resolve(__dirname, "../../ci/trivy.sh"), "utf8");

/** The real script with one property removed; throws if the edit did not apply. */
function without(from: string | RegExp, to: string): string {
  const out = real.replace(from, to);
  if (out === real) throw new Error(`fixture edit ${String(from)} did not apply`);
  return out;
}

const FIXTURES: Record<string, string> = {
  "without the secret and misconfig scanners": without("--scanners vuln,secret,misconfig", "--scanners vuln"),
  "with the CRITICAL severity dropped": without("--severity HIGH,CRITICAL", "--severity HIGH"),
  "without --include-dev-deps": without(/^\s*--include-dev-deps \\\n/m, ""),
  "with a non-blocking exit code": without("--exit-code 1", "--exit-code 0"),
  "without the fresh-DB removal": without("rm -rf /cache/db /cache/java-db", "true"),
};

describe("ci/trivy.sh is the blocking Trivy gate", () => {
  it("runs a pinned image in fs mode with vuln, secret and misconfig scanners, HIGH,CRITICAL, dev deps, exit code 1 and a fresh-DB mode", () => {
    expect(trivyGateProblems(real)).toEqual([]);
  });

  it.each(Object.entries(FIXTURES))("is red for a copy %s", (_name, fixture) => {
    expect(trivyGateProblems(fixture).length).toBeGreaterThan(0);
  });

  it("names the removed property in each red copy", () => {
    const names = Object.values(FIXTURES).map((f) => trivyGateProblems(f).join("; "));
    expect(names[0]).toContain("scanners");
    expect(names[1]).toContain("severity");
    expect(names[2]).toContain("dev dependencies");
    expect(names[3]).toContain("exit 1");
    expect(names[4]).toContain("fresh mode");
  });
});
