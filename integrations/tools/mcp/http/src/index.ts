import { McpToolsError } from "./errors.ts";
import type { Integration } from "./kit.ts";

/**
 * Tools from any MCP server the workspace chooses. It declares none: the
 * server decides them, so the connection lists them with `listTools`.
 * The MCP client behind it follows in the next pull request.
 */
export const mcpHttp: Integration = {
  name: "tool-mcp-http",
  version: "0.1.0",
  tools: [],
  connect() {
    return {
      callTool: async () => {
        throw new McpToolsError("not-found", "tool-mcp-http can't call tools yet.");
      },
      listTools: async () => [],
      close: async () => {},
    };
  },
};

export { McpToolsError, type McpToolsErrorCode } from "./errors.ts";
export type { Integration, IntegrationHost, IntegrationTool } from "./kit.ts";
