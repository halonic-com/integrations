import { mcpToolsIntegration, type ToolsIntegration } from "@halonicjs/integration-mcp-server";

/**
 * "MCP server online": tools from an MCP server on the internet, over
 * https. The code is in `mcp-server`; the sheet keeps it on public hosts.
 */
export const mcpHttpOnline: ToolsIntegration = mcpToolsIntegration({
  name: "tool-mcp-http-online",
  version: "0.1.0",
});

export {
  type IntegrationHost,
  type IntegrationTool,
  McpToolsError,
  type McpToolsErrorCode,
  type ToolsIntegration as Integration,
} from "@halonicjs/integration-mcp-server";
