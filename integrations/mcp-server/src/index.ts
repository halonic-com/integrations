// The MCP server the workspace chooses, as tools (`tools/`) or as a
// knowledge source (`knowledge/`). Each entry package, "on this computer"
// or "online", is this code with its own sheet and name.

// The host is the same for both: the MCP client's `McpHost` and `settings`.
export type {
  Integration as KnowledgeIntegration,
  Integration as ToolsIntegration,
  IntegrationHost,
  IntegrationTool,
  KnowledgeDoc,
  KnowledgeHit,
  KnowledgeProvider,
} from "@halonicjs/adapters/integration-kit";
export type { IntegrationEntry } from "./entry.ts";
export { KnowledgeMcpError, type KnowledgeMcpErrorCode } from "./knowledge/errors.ts";
export { mcpKnowledgeIntegration } from "./knowledge/integration.ts";
export { type KnowledgeSource, McpKnowledgeProvider } from "./knowledge/provider.ts";
export { McpToolsError, type McpToolsErrorCode } from "./tools/errors.ts";
export { mcpToolsIntegration } from "./tools/integration.ts";
