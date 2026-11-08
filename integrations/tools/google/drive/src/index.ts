import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { DriveClient } from "./client.ts";
import { type Integration, runTool, type ToolImplementation } from "./kit.ts";
import { getFileTool } from "./tools/get-file.ts";
import { readFileTool } from "./tools/read-file.ts";
import { searchTool } from "./tools/search.ts";

/**
 * The same tools, in the same order, as in integration.yaml. The rest of
 * the sheet's tools follow in the next pull requests.
 */
const tools: readonly ToolImplementation<DriveClient>[] = [searchTool, getFileTool, readFileTool];

export const drive: Integration = {
  name: "tool-google-drive",
  version: "0.1.0",
  tools: tools.map((tool) => tool.declaration),
  connect(host) {
    // No request here: Drive is only called when a tool is.
    const client = new DriveClient(host);
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
