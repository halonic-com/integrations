import { mcpToolsIntegration, type ToolsIntegration } from "@halonicjs/integration-mcp-server";

/**
 * "MCP server on this computer": tools from an MCP server that runs on this
 * computer. The code is in `mcp-server`; the sheet keeps it on loopback.
 */
export const mcpHttpLocal: ToolsIntegration = mcpToolsIntegration({
  name: "tool-mcp-http-local",
  version: "0.1.0",
});

export {
  type IntegrationHost,
  type IntegrationTool,
  McpToolsError,
  type McpToolsErrorCode,
  type ToolsIntegration as Integration,
} from "@halonicjs/integration-mcp-server";
