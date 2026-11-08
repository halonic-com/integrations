import { describe, expect, it } from "vitest";
import { placeOf } from "./layout.ts";

describe("placeOf", () => {
  it.each([
    [".", "tooling", "@halonicjs/root"],
    ["integrations/gmail", "integrations", "@halonicjs/integration-gmail"],
    ["integrations/llm-openai", "integrations", "@halonicjs/integration-llm-openai"],
    ["tooling/check", "tooling", "@halonicjs/tooling-check"],
  ])("derives layer and name for %s", (directory, layer, expectedName) => {
    expect(placeOf(directory)).toMatchObject({ layer, expectedName });
  });

  it("returns undefined outside the package folders", () => {
    expect(placeOf("docs/guides")).toBeUndefined();
    expect(placeOf("integrations/google/gmail")).toBeUndefined();
    expect(placeOf("packages/core/std")).toBeUndefined();
  });
});
