import {
  type KnowledgeIntegration,
  mcpKnowledgeIntegration,
} from "@halonicjs/integration-mcp-server";

/** A knowledge source on any MCP server. The code is in `mcp-server`. */
export const knowledgeMcp: KnowledgeIntegration = mcpKnowledgeIntegration({
  name: "knowledge-mcp",
  version: "0.1.0",
});

export {
  type IntegrationHost,
  type KnowledgeDoc,
  type KnowledgeHit,
  type KnowledgeIntegration as Integration,
  KnowledgeMcpError,
  type KnowledgeMcpErrorCode,
  type KnowledgeProvider,
  type KnowledgeSource,
  McpKnowledgeProvider,
} from "@halonicjs/integration-mcp-server";
