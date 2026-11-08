import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { GmailClient } from "./client.ts";
import { type Integration, runTool, type ToolImplementation } from "./kit.ts";
import { searchTool } from "./tools/search.ts";

/**
 * The same tools, in the same order, as in integration.yaml. The rest of
 * the sheet's tools follow in the next pull requests.
 */
const tools: readonly ToolImplementation<GmailClient>[] = [searchTool];

export const gmail: Integration = {
  name: "tool-google-gmail",
  version: "0.1.0",
  tools: tools.map((tool) => tool.declaration),
  connect(host) {
    // No request here: Gmail is only called when a tool is.
    const client = new GmailClient(host);
    return {
      callTool: (name, args, signal) =>
        runTool(
          tools,
          client,
          { name, args, signal },
          (code, message) => new GoogleError(code, message),
        ),
      close: async () => {},
    };
  },
};

export type { Integration, IntegrationHost, IntegrationTool } from "./kit.ts";
