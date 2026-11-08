import { McpClient, type McpHost, StreamableHttpTransport } from "@halonicjs/integration-mcp";
import type { SecretPlacement } from "@halonicjs/integration-shared";
import { readSettings } from "./config.ts";
import { KnowledgeMcpError } from "./errors.ts";

/** The secret the sheet declares; the kit adds its value, which we never see. */
const serverKey: SecretPlacement = { secret: "mcp-server-key", as: "bearer" };

/** How we introduce ourselves to the server. */
const clientInfo = { name: "halonic-knowledge-mcp", version: "0.1.0" };

/**
 * The connection's one MCP server, shared by all its knowledge sources.
 *
 * Sends nothing until a source searches or reads: the client opens the
 * session on the first call (see {@link McpClient}). The workspace's
 * settings are read then too, so wrong settings fail that call with
 * `bad-config`, not `connect`. A server that offers no tools is refused,
 * since a source searches and reads through two of them.
 */
export function connectToServer(
  host: McpHost,
  settings: Readonly<Record<string, unknown>>,
): McpClient {
  return new McpClient({
    clientInfo,
    openTransport: () =>
      new StreamableHttpTransport(host, { url: readSettings(settings).url, auth: serverKey }),
    checkAgreement: (agreement) => {
      if (!agreement.offersTools) {
        throw new KnowledgeMcpError("not-found", "The MCP server offers no tools to search with.");
      }
    },
  });
}
