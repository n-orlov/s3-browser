import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";

const REQUIRED_ECOSYSTEMS = ["npm", "github-actions"];

/** Returns one problem string per violation of the Dependabot policy. */
function dependabotProblems(config: unknown): string[] {
  const problems: string[] = [];
  const root = config as { version?: unknown; updates?: unknown } | null;
  if (root?.version !== 2) problems.push("version must be 2");
  const updates = Array.isArray(root?.updates) ? root.updates : [];
  const ecosystems = updates.map(
    (u: { "package-ecosystem"?: string }) => u["package-ecosystem"],
  );
  if (
    updates.length !== REQUIRED_ECOSYSTEMS.length ||
    [...ecosystems].sort().join() !== [...REQUIRED_ECOSYSTEMS].sort().join()
  ) {
    problems.push(
      `updates must be exactly ${REQUIRED_ECOSYSTEMS.join(", ")}, got ${ecosystems.join(", ")}`,
    );
  }
  for (const ecosystem of REQUIRED_ECOSYSTEMS) {
    const entry = updates.find(
      (u: { "package-ecosystem"?: string }) =>
        u["package-ecosystem"] === ecosystem,
    ) as
      | {
          directory?: string;
          schedule?: { interval?: string };
          groups?: Record<string, { "update-types"?: string[] }>;
        }
      | undefined;
    if (!entry) continue;
    if (entry.directory !== "/") problems.push(`${ecosystem}: directory must be /`);
    if (entry.schedule?.interval !== "weekly")
      problems.push(`${ecosystem}: schedule interval must be weekly`);
    const grouped = Object.values(entry.groups ?? {}).some((g) => {
      const types = [...(g["update-types"] ?? [])].sort();
      return types.join() === "minor,patch";
    });
    if (!grouped)
      problems.push(`${ecosystem}: needs a group with update-types minor and patch`);
  }
  return problems;
}

const file = path.resolve(__dirname, "../../.github/dependabot.yml");
const config = parse(readFileSync(file, "utf-8")) as {
  updates: Record<string, unknown>[];
};

/** True when the npm entry ignores typescript major 7 (typescript-eslint peers typescript <6.1.0). */
function ignoresTypescript7(cfg: { updates: Record<string, unknown>[] }): boolean {
  const npm = cfg.updates.find((u) => u["package-ecosystem"] === "npm") as
    | { ignore?: { "dependency-name"?: string; versions?: string[] }[] }
    | undefined;
  return (npm?.ignore ?? []).some(
    (i) => i["dependency-name"] === "typescript" && (i.versions ?? []).includes("7.x"),
  );
}

describe(".github/dependabot.yml", () => {
  it("ignores typescript major 7 on the npm entry", () => {
    expect(ignoresTypescript7(config)).toBe(true);
  });

  it("detects a removed typescript 7 ignore", () => {
    const broken = structuredClone(config);
    delete broken.updates[0].ignore;
    expect(ignoresTypescript7(broken)).toBe(false);
  });


  it("covers npm and github-actions weekly with grouped minor/patch updates", () => {
    expect(dependabotProblems(config)).toEqual([]);
  });

  it("rejects a missing ecosystem", () => {
    const broken = { ...config, updates: config.updates.slice(0, 1) };
    expect(dependabotProblems(broken)).not.toEqual([]);
  });

  it("rejects an extra ecosystem", () => {
    const extra = { "package-ecosystem": "docker", directory: "/" };
    const broken = { ...config, updates: [...config.updates, extra] };
    expect(dependabotProblems(broken)).not.toEqual([]);
  });

  it("rejects a non-weekly interval", () => {
    const broken = structuredClone(config);
    broken.updates[0].schedule = { interval: "daily" };
    expect(dependabotProblems(broken)).toEqual([
      expect.stringContaining("weekly"),
    ]);
  });

  it("rejects a group missing the patch update type", () => {
    const broken = structuredClone(config);
    broken.updates[1].groups = { g: { "update-types": ["minor"] } };
    expect(dependabotProblems(broken)).toEqual([
      expect.stringContaining("minor and patch"),
    ]);
  });

  it("rejects a missing group", () => {
    const broken = structuredClone(config);
    delete broken.updates[0].groups;
    expect(dependabotProblems(broken)).toEqual([
      expect.stringContaining("minor and patch"),
    ]);
  });
});
