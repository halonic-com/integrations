import {
  type KnowledgeIntegration,
  mcpKnowledgeIntegration,
} from "@halonicjs/integration-mcp-server";

/**
 * "MCP server on this computer": a knowledge source on an MCP server that
 * runs on this computer. The code is in `mcp-server`; the sheet keeps it on
 * loopback.
 */
export const knowledgeMcpLocal: KnowledgeIntegration = mcpKnowledgeIntegration({
  name: "knowledge-mcp-local",
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
