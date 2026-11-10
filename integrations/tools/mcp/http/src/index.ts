import { mcpToolsIntegration, type ToolsIntegration } from "@halonicjs/integration-mcp-server";

/** Tools from any MCP server the workspace chooses. The code is in `mcp-server`. */
export const mcpHttp: ToolsIntegration = mcpToolsIntegration({
  name: "tool-mcp-http",
  version: "0.1.0",
});

export {
  type IntegrationHost,
  type IntegrationTool,
  McpToolsError,
  type McpToolsErrorCode,
  type ToolsIntegration as Integration,
} from "@halonicjs/integration-mcp-server";
