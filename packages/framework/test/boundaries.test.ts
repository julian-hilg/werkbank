import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The module boundaries that keep the shell swappable and testable.
 * If one of these fails, move the code; do not relax the rule.
 */
const SRC = join(__dirname, "../src");

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

const imports = (path: string) =>
  [...readFileSync(path, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);

const offenders = (inDir: string, banned: (spec: string) => boolean) =>
  files(join(SRC, inDir))
    .filter((path) => imports(path).some(banned))
    .map((path) => relative(SRC, path));

describe("module boundaries", () => {
  it("only layout/ imports the layout library", () => {
    const outside = files(SRC)
      .filter((path) => !path.startsWith(join(SRC, "layout")))
      .filter((path) => imports(path).includes("react-resizable-panels"))
      .map((path) => relative(SRC, path));
    expect(outside).toEqual([]);
  });

  it("core/ is free of React and of the other modules", () => {
    expect(offenders("core", (s) => s.startsWith("react") || s.startsWith("../"))).toEqual([]);
  });

  it("tools/ and layout/ do not reach into shell/", () => {
    expect(offenders("tools", (s) => s.includes("/shell"))).toEqual([]);
    expect(offenders("layout", (s) => s.includes("/shell") || s.includes("/tools"))).toEqual([]);
  });

  it("components use theme tokens, never literal colours", () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
    const withColour = files(SRC).filter((path) => path.endsWith(".tsx") && literal.test(readFileSync(path, "utf8")));
    expect(withColour.map((path) => relative(SRC, path))).toEqual([]);
  });
});
