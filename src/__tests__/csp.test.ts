import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const html = readFileSync(
  path.resolve(__dirname, "../renderer/index.html"),
  "utf-8",
);

/** Parse the CSP <meta> content attribute into directive name -> sources. */
function parseCsp(source: string): Record<string, string[]> {
  const match = source.match(
    /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content="([^"]*)"/i,
  );
  if (!match) throw new Error("CSP meta tag not found");
  const directives: Record<string, string[]> = {};
  for (const part of match[1].split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    directives[tokens[0]] = tokens.slice(1);
  }
  return directives;
}

describe("renderer CSP", () => {
  const csp = parseCsp(html);

  it("is present with a default-src directive", () => {
    expect(csp["default-src"]).toEqual(["'self'"]);
  });

  it("allows no http(s) origin in any directive", () => {
    const remote = Object.entries(csp).flatMap(([name, sources]) =>
      sources
        .filter((s) => /^(https?:|\/\/)/i.test(s) || /https?:\/\//i.test(s))
        .map((s) => `${name}: ${s}`),
    );
    expect(remote).toEqual([]);
  });

  it("allows no remote origin in script-src, style-src or font-src", () => {
    for (const name of ["script-src", "style-src", "font-src"]) {
      for (const source of csp[name]) {
        expect(source).toMatch(/^('[a-z-]+'|blob:|data:)$/);
      }
    }
  });

  it("the parser detects a remote origin (guard against a vacuous check)", () => {
    const parsed = parseCsp(
      `<meta http-equiv="Content-Security-Policy" content="script-src 'self' https://cdn.jsdelivr.net;">`,
    );
    expect(parsed["script-src"]).toContain("https://cdn.jsdelivr.net");
  });
});
