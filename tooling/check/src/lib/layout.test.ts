import { describe, expect, it } from "vitest";
import { placeOf } from "./layout.ts";

describe("placeOf", () => {
  it.each([
    [".", "tooling", "@halonicjs/root"],
    ["integrations/mcp", "integrations", "@halonicjs/integration-mcp"],
    ["integrations/models/anthropic", "integrations", "@halonicjs/integration-model-anthropic"],
    ["integrations/knowledge/mcp", "integrations", "@halonicjs/integration-knowledge-mcp"],
    ["integrations/tools/google/gmail", "integrations", "@halonicjs/integration-tool-google-gmail"],
    [
      "integrations/tools/google/shared",
      "integrations",
      "@halonicjs/integration-tool-google-shared",
    ],
    ["tooling/check", "tooling", "@halonicjs/tooling-check"],
  ])("derives layer and name for %s", (directory, layer, expectedName) => {
    expect(placeOf(directory)).toMatchObject({ layer, expectedName });
  });

  it.each([
    "docs/guides",
    "packages/core/std",
    "tooling/check/fixtures",
    // a group folder is never an integration itself
    "integrations/models",
    "integrations/knowledge",
    "integrations/tools",
    "integrations/tools/google",
    // a folder level missing or extra
    "integrations/google/gmail",
    "integrations/models/openai/chat",
    "integrations/tools/google/gmail/labels",
    // an ungrouped folder may not take a group's prefix
    "integrations/model-anthropic",
    "integrations/tool-google-gmail",
    "integrations/knowledge-mcp",
    // an inherited object key is not a group
    "integrations/constructor/x",
  ])("returns undefined for %s", (directory) => {
    expect(placeOf(directory)).toBeUndefined();
  });
});
