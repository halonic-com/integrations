import type { IntegrationEntry } from "../entry.ts";
import { KnowledgeMcpError } from "./errors.ts";
import type { Integration } from "./kit.ts";
import { McpKnowledgeProvider } from "./provider.ts";
import { connectToServer } from "./server.ts";

/**
 * A knowledge source on the MCP server the workspace chooses, as the
 * integration `entry`: search and get map onto two of the server's tools.
 * A knowledge source only: it offers agents no tools. Where the server may
 * be is the sheet's business: the same code serves a server on this
 * computer and one online.
 *
 * @example
 * export const knowledgeMcpOnline = mcpKnowledgeIntegration({
 *   name: "knowledge-mcp-online",
 *   version: "0.1.0",
 * });
 */
export function mcpKnowledgeIntegration(entry: IntegrationEntry): Integration {
  return {
    name: entry.name,
    version: entry.version,
    tools: [],
    connect(host) {
      // No request here: the server is only called when a source searches or reads.
      const server = connectToServer(host, host.settings, entry);
      return {
        callTool: async () => {
          throw new KnowledgeMcpError("not-found", `${entry.name} has no tools.`);
        },
        createKnowledgeProvider: (source) => new McpKnowledgeProvider(server, source),
        close: () => server.close(),
      };
    },
  };
}
