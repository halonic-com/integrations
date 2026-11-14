import { describeIntegrationConformance } from "@halonicjs/testing/integration";
import { readSheetData } from "@halonicjs/tooling-record/sheet-data";
import { readSources } from "@halonicjs/tooling-record/sources";
import { knowledgeMcpLocal } from "./index.ts";

/**
 * The shared conformance suite (guide, section 9), on "MCP server on this computer". The sheet
 * declares no tools, so there are no cases to replay: the suite checks the
 * code against the sheet and scans the sources. Searching and reading are
 * covered by `integration.test.ts`, from the recordings.
 */

describeIntegrationConformance({
  integration: knowledgeMcpLocal,
  sheet: readSheetData(new URL("../integration.yaml", import.meta.url)),
  // A `fromSetting` host needs a value to resolve; the suite sends nothing to it.
  settings: { url: "http://localhost:8080/mcp" },
  recordings: [],
  cases: [],
  sources: {
    ...readSources(new URL("./", import.meta.url), "knowledge/mcp-local/src"),
    ...readSources(new URL("../../../mcp-server/src/", import.meta.url), "mcp-server/src"),
  },
});
