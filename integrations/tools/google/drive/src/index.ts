import {
  type Integration,
  runTool,
  type ToolImplementation,
} from "@halonicjs/adapters/integration-kit";
import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { DriveClient } from "./client.ts";
import { createFileTool } from "./tools/create-file.ts";
import { createFolderTool } from "./tools/create-folder.ts";
import { getFileTool } from "./tools/get-file.ts";
import { moveFileTool } from "./tools/move-file.ts";
import { readFileTool } from "./tools/read-file.ts";
import { searchTool } from "./tools/search.ts";
import { treeTool } from "./tools/tree.ts";
import { updateFileTool } from "./tools/update-file.ts";

/** The same tools, in the same order, as in integration.yaml. */
const tools: readonly ToolImplementation<DriveClient>[] = [
  treeTool,
  searchTool,
  getFileTool,
  readFileTool,
  createFileTool,
  updateFileTool,
  createFolderTool,
  moveFileTool,
];

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

export type {
  Integration,
  IntegrationHost,
  IntegrationTool,
} from "@halonicjs/adapters/integration-kit";
