import type { IntegrationEntry } from "../entry.ts";
import { McpToolsConnection } from "./connection.ts";
import type { Integration } from "./kit.ts";
import { mcpClientFor } from "./server.ts";

/**
 * Tools from the MCP server the workspace chooses, as the integration
 * `entry`. It declares none: the server decides them, so the connection
 * lists them with `listTools`. Where the server may be is the sheet's
 * business: the same code serves a server on this computer and one online.
 *
 * @example
 * export const mcpHttp = mcpToolsIntegration({ name: "tool-mcp-http", version: "0.1.0" });
 */
export function mcpToolsIntegration(entry: IntegrationEntry): Integration {
  return {
    name: entry.name,
    version: entry.version,
    tools: [],
    // No request here: the server is only called when a tool is listed or called.
    connect: (host) => new McpToolsConnection(mcpClientFor(host, entry)),
  };
}
