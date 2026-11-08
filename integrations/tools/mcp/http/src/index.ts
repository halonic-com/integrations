import { McpToolsConnection } from "./connection.ts";
import type { Integration } from "./kit.ts";
import { mcpClientFor } from "./server.ts";

/**
 * Tools from any MCP server the workspace chooses. It declares none: the
 * server decides them, so the connection lists them with `listTools`.
 */
export const mcpHttp: Integration = {
  name: "tool-mcp-http",
  version: "0.1.0",
  tools: [],
  // No request here: the server is only called when a tool is listed or called.
  connect: (host) => new McpToolsConnection(mcpClientFor(host)),
};

export { McpToolsError, type McpToolsErrorCode } from "./errors.ts";
export type { Integration, IntegrationHost, IntegrationTool } from "./kit.ts";
