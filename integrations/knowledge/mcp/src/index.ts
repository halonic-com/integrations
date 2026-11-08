import { KnowledgeMcpError } from "./errors.ts";
import type { Integration } from "./kit.ts";

/**
 * A knowledge source on any MCP server: search and get map onto two of the
 * server's tools. A knowledge source only: it offers agents no tools. The
 * knowledge provider follows in the next pull requests.
 */
export const knowledgeMcp: Integration = {
  name: "knowledge-mcp",
  version: "0.1.0",
  tools: [],
  connect() {
    // No request here: the server is only called when a source searches or reads.
    return {
      callTool: async () => {
        throw new KnowledgeMcpError("not-found", "knowledge-mcp has no tools.");
      },
      close: async () => {},
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
