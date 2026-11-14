import { describe, expect, it } from "vitest";
import { readSources } from "./sources.ts";

describe("readSources", () => {
  const sources = readSources(new URL("./", import.meta.url), "tooling/record/src");

  it("reads source files under the prefix", () => {
    expect(sources["tooling/record/src/sources.ts"]).toContain("export function readSources");
  });

  it("leaves out tests and files under a test folder", () => {
    const paths = Object.keys(sources);
    expect(paths.filter((path) => path.endsWith(".test.ts"))).toEqual([]);
    expect(paths.filter((path) => path.split("/").includes("test"))).toEqual([]);
  });
});
