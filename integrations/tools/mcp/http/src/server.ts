import { McpClient, StreamableHttpTransport } from "@halonicjs/integration-mcp";
import type { SecretPlacement } from "@halonicjs/integration-shared";
import type { IntegrationHost } from "./kit.ts";
import { readSettings } from "./settings.ts";

/** The secret the sheet declares; the kit adds its value, which we never see. */
const serverKey: SecretPlacement = { secret: "mcp-server-key", as: "bearer" };

/** How we introduce ourselves to the server. */
const clientInfo = { name: "halonic-tool-mcp-http", version: "0.1.0" };

/**
 * The connection's MCP client for the server in the `url` setting. It
 * sends nothing until the first call, and reads the settings only then, so
 * a wrong `url` fails that call with `bad-config`.
 */
export function mcpClientFor(host: IntegrationHost): McpClient {
  return new McpClient({
    clientInfo,
    openTransport: () =>
      new StreamableHttpTransport(host, {
        url: readSettings(host.settings).url,
        auth: serverKey,
      }),
  });
}
