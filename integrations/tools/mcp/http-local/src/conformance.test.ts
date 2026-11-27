import { describeIntegrationConformance } from "@halonicjs/testing/integration";
import { readSheetData } from "@halonicjs/tooling-record/sheet-data";
import { readSources } from "@halonicjs/tooling-record/sources";
import { mcpHttpLocal } from "./index.ts";

/**
 * The shared conformance suite (guide, section 9), on "MCP server on this computer". The server
 * decides its tools, so the sheet declares none and there are no cases to
 * replay: the suite checks the code against the sheet and scans the sources.
 * Listing and calling tools are covered by `integration.test.ts`, from the
 * recordings.
 */

describeIntegrationConformance({
  integration: mcpHttpLocal,
  sheet: readSheetData(new URL("../integration.yaml", import.meta.url)),
  // A `fromSetting` host needs a value to resolve; the suite sends nothing to it.
  settings: { url: "http://localhost:8080/mcp" },
  recordings: [],
  cases: [],
  // In-repo packages the build bundles into this integration.
  bundled: [
    "@halonicjs/integration-mcp-server",
    "@halonicjs/integration-mcp",
    "@halonicjs/integration-shared",
  ],
  sources: {
    ...readSources(new URL("./", import.meta.url), "tools/mcp/http-local/src"),
    ...readSources(new URL("../../../../mcp-server/src/", import.meta.url), "mcp-server/src"),
    ...readSources(new URL("../../../../mcp/src/", import.meta.url), "mcp/src"),
    ...readSources(new URL("../../../../shared/src/", import.meta.url), "shared/src"),
  },
});
