import { describe, expect, it } from "vitest";
import { ImportNotAllowed, rewriteImports } from "./imports.ts";

const resolve = (specifier: string) =>
  specifier === "@halonicjs/adapters/integration-kit" ? "../vendor/kit/index.js" : undefined;

describe("rewriteImports", () => {
  it("turns a package import into the path of its copy", () => {
    const code = 'import { runTool } from "@halonicjs/adapters/integration-kit";';
    expect(rewriteImports(code, "index.js", resolve)).toBe(
      'import { runTool } from "../vendor/kit/index.js";',
    );
  });

  it("also rewrites re-exports and imports without names", () => {
    const code = [
      'export { a } from "@halonicjs/adapters/integration-kit";',
      'import "@halonicjs/adapters/integration-kit";',
    ].join("\n");
    expect(rewriteImports(code, "index.js", resolve)).toBe(
      ['export { a } from "../vendor/kit/index.js";', 'import "../vendor/kit/index.js";'].join(
        "\n",
      ),
    );
  });

  it("keeps relative imports and zod as they are", () => {
    const code = [
      'import { a } from "./a.js";',
      'import { b } from "../b.js";',
      'import { z } from "zod";',
    ].join("\n");
    expect(rewriteImports(code, "index.js", resolve)).toBe(code);
  });

  it("refuses a package it has no copy of, naming the file and the import", () => {
    const code = 'import { readFile } from "node:fs/promises";';
    expect(() => rewriteImports(code, "client.js", resolve)).toThrow(ImportNotAllowed);
    expect(() => rewriteImports(code, "client.js", resolve)).toThrow(
      'client.js imports "node:fs/promises"',
    );
  });
});
