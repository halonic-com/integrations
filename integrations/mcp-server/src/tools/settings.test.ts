import { describe, expect, it } from "vitest";
import { readSettings } from "./settings.ts";

describe("readSettings", () => {
  it("reads the server's url", () => {
    expect(readSettings({ url: "https://tools.example.com/mcp" }, "tool-mcp-http-online")).toEqual({
      url: "https://tools.example.com/mcp",
    });
  });

  it.each([
    ["missing", {}],
    ["not an address", { url: "tools.example.com" }],
    ["not a string", { url: 42 }],
  ])("refuses a url that is %s, naming the field and never its value", (_case, settings) => {
    expect(() => readSettings(settings, "tool-mcp-http-online")).toThrow(
      expect.objectContaining({
        name: "McpToolsError",
        code: "bad-config",
        message: "Check the tool-mcp-http-online settings: url.",
      }),
    );
  });
});
