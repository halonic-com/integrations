import { KnowledgeMcpError } from "./errors.ts";
import type { Integration } from "./kit.ts";
import { McpKnowledgeProvider } from "./provider.ts";
import { McpServer } from "./server.ts";

/**
 * A knowledge source on any MCP server: search and get map onto two of the
 * server's tools. A knowledge source only: it offers agents no tools.
 */
export const knowledgeMcp: Integration = {
  name: "knowledge-mcp",
  version: "0.1.0",
  tools: [],
  connect(host) {
    // No request here: the server is only called when a source searches or reads.
    const server = new McpServer(host.http, host.settings);
    return {
      callTool: async () => {
        throw new KnowledgeMcpError("not-found", "knowledge-mcp has no tools.");
      },
      createKnowledgeProvider: (source) => new McpKnowledgeProvider(server, source),
      close: () => server.close(),
    };
  },
};

export { KnowledgeMcpError, type KnowledgeMcpErrorCode } from "./errors.ts";
export type {
  Integration,
  IntegrationHost,
  KnowledgeDoc,
  KnowledgeHit,
  KnowledgeProvider,
  KnowledgeSource,
} from "./kit.ts";
export { McpKnowledgeProvider } from "./provider.ts";
