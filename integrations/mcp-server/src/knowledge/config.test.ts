import { describe, expect, it } from "vitest";
import { readSettings, readSourceConfig } from "./config.ts";

describe("readSettings", () => {
  it("reads the url", () => {
    expect(readSettings({ url: "https://docs.example.com/mcp" }, "knowledge-mcp-online")).toEqual({
      url: "https://docs.example.com/mcp",
    });
  });

  it("ignores the old sendKey setting: the kit decides by whether the key is set up", () => {
    expect(
      readSettings({ url: "http://localhost:8080/mcp", sendKey: false }, "knowledge-mcp-online"),
    ).toEqual({
      url: "http://localhost:8080/mcp",
    });
  });

  it.each([{}, { url: "docs.example.com" }, { url: "ftp://docs.example.com" }])(
    "refuses a missing or wrong url, naming it: %j",
    (settings) => {
      expect(() => readSettings(settings, "knowledge-mcp-online")).toThrow(
        expect.objectContaining({
          code: "bad-config",
          message: "Check the knowledge-mcp-online settings: url.",
        }),
      );
    },
  );
});

describe("readSourceConfig", () => {
  it("fills in the old source's argument names", () => {
    expect(readSourceConfig("handbook", { searchTool: "search_docs" })).toEqual({
      searchTool: "search_docs",
      queryArg: "query",
      refArg: "ref",
    });
  });

  it("drops url, secret and headers: they are never read", () => {
    const config = readSourceConfig("handbook", {
      searchTool: "search_docs",
      getTool: "read_doc",
      url: "https://elsewhere.example.net/mcp",
      secret: "some-other-secret",
      headers: { "x-forwarded": "from-config" },
    });
    expect(Object.keys(config).sort()).toEqual(["getTool", "queryArg", "refArg", "searchTool"]);
  });

  it("names the wrong fields, never their values", () => {
    const read = () =>
      readSourceConfig("handbook", { searchTool: "no spaces allowed", refArg: "__proto__" });
    expect(read).toThrow("Check the config of knowledge source handbook: searchTool, refArg.");
  });

  it("refuses limit as the query's name, because the source sends limit itself", () => {
    expect(() => readSourceConfig("handbook", { searchTool: "s", queryArg: "limit" })).toThrow(
      /queryArg/,
    );
  });
});
