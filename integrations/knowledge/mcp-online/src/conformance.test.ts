import { readdirSync, readFileSync } from "node:fs";
import { describeIntegrationConformance } from "@halonicjs/testing/integration";
import { readSheetData } from "@halonicjs/tooling-record/sheet-data";
import { knowledgeMcpOnline } from "./index.ts";

/**
 * The shared conformance suite (guide, section 9), on "MCP server online". The sheet
 * declares no tools, so there are no cases to replay: the suite checks the
 * code against the sheet and scans the sources. Searching and reading are
 * covered by `integration.test.ts`, from the recordings.
 */

/** Every source file of the shared MCP code, except the tests, by the path the suite reports. */
function mcpServerSources(): Record<string, string> {
  const folder = new URL("../../../mcp-server/src/", import.meta.url);
  const files = readdirSync(folder, { recursive: true, encoding: "utf8" });
  return Object.fromEntries(
    files
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) => !file.split("/").includes("test"))
      .map((file) => [`mcp-server/src/${file}`, readFileSync(new URL(file, folder), "utf8")]),
  );
}

describeIntegrationConformance({
  integration: knowledgeMcpOnline,
  sheet: readSheetData(new URL("../integration.yaml", import.meta.url)),
  // A `fromSetting` host needs a value to resolve; the suite sends nothing to it.
  settings: { url: "https://mcp.example.com/mcp" },
  recordings: [],
  cases: [],
  sources: mcpServerSources(),
});
