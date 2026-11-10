import {
  type KnowledgeIntegration,
  mcpKnowledgeIntegration,
} from "@halonicjs/integration-mcp-server";

/**
 * "MCP server online": a knowledge source on an MCP server on the
 * internet, over https. The code is in `mcp-server`; the sheet keeps it on
 * public hosts.
 */
export const knowledgeMcpOnline: KnowledgeIntegration = mcpKnowledgeIntegration({
  name: "knowledge-mcp-online",
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
