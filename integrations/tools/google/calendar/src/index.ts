import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { type Integration, runTool, type ToolImplementation } from "./kit.ts";

/**
 * The same tools, in the same order, as in integration.yaml. The sheet
 * comes first (guide, section 3); the tools follow in the next pull
 * requests.
 */
const tools: readonly ToolImplementation<undefined>[] = [];

export const calendar: Integration = {
  name: "tool-google-calendar",
  version: "0.1.0",
  tools: tools.map((tool) => tool.declaration),
  connect() {
    // No request here: Calendar is only called when a tool is.
    return {
      callTool: (name, args, signal) =>
        runTool(
          tools,
          undefined,
          { name, args, signal },
          (code, message) => new GoogleError(code, message),
        ),
      close: async () => {},
    };
  },
};

export type { Integration, IntegrationHost, IntegrationTool } from "./kit.ts";
