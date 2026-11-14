import type { IntegrationHost } from "@halonicjs/adapters/integration-kit";
import { McpClient, StreamableHttpTransport } from "@halonicjs/integration-mcp";
import type { SecretPlacement } from "@halonicjs/integration-shared";
import { clientInfoOf, type IntegrationEntry } from "../entry.ts";
import { readSettings } from "./settings.ts";

/** The secret the sheet declares; the kit adds its value, which we never see. */
const serverKey: SecretPlacement = { secret: "mcp-server-key", as: "bearer" };

/**
 * The connection's MCP client for the server in the `url` setting. It
 * sends nothing until the first call, and reads the settings only then, so
 * a wrong `url` fails that call with `bad-config`.
 */
export function mcpClientFor(host: IntegrationHost, entry: IntegrationEntry): McpClient {
  return new McpClient({
    clientInfo: clientInfoOf(entry),
    openTransport: () =>
      new StreamableHttpTransport(host, {
        url: readSettings(host.settings, entry.name).url,
        auth: serverKey,
      }),
  });
}
