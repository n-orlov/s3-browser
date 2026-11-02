import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Returns one problem string per violation of the non-root policy: the last
 * USER instruction before the final CMD must name a user that is not root/0.
 */
function dockerfileUserProblems(dockerfile: string): string[] {
  // Join line continuations, drop comments and blank lines.
  const lines = dockerfile
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  const cmdIndex = lines.reduce(
    (last, l, i) => (/^CMD\b/i.test(l) ? i : last),
    lines.length,
  );
  const users = lines
    .slice(0, cmdIndex)
    .filter((l) => /^USER\s/i.test(l))
    .map((l) => l.split(/\s+/)[1] ?? "");
  if (users.length === 0) return ["no USER instruction before CMD"];
  const last = users[users.length - 1];
  const name = last.split(":")[0];
  if (name === "root" || name === "0" || name === "") {
    return [`final USER before CMD is ${last}, expected a non-root user`];
  }
  return [];
}

const BASE = "FROM node:22\nWORKDIR /app\nCOPY . .\n";
const FIXTURES = {
  "without USER": `${BASE}CMD ["node", "x.js"]\n`,
  "ending in USER root": `${BASE}USER builder\nUSER root\nCMD ["node", "x.js"]\n`,
  "ending in USER 0": `${BASE}USER builder\nUSER 0\nCMD ["node", "x.js"]\n`,
  "ending in USER root:root": `${BASE}USER root:root\nCMD ["node", "x.js"]\n`,
};

describe("docker/Dockerfile.build runs as a non-root user", () => {
  it("declares a non-root USER before CMD", () => {
    const file = path.resolve(__dirname, "../../docker/Dockerfile.build");
    expect(dockerfileUserProblems(readFileSync(file, "utf8"))).toEqual([]);
  });

  it.each(Object.entries(FIXTURES))(
    "is red for a Dockerfile %s",
    (_name, fixture) => {
      expect(dockerfileUserProblems(fixture).length).toBeGreaterThan(0);
    },
  );

  it("accepts a Dockerfile with a non-root USER", () => {
    expect(
      dockerfileUserProblems(`${BASE}USER 1000:1000\nCMD ["node"]\n`),
    ).toEqual([]);
  });
});
