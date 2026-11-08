import type { McpClient } from "@halonicjs/integration-mcp";
import { McpToolsError, withMcpToolsErrors } from "./errors.ts";
import type { AbortSignal, IntegrationConnection, IntegrationTool } from "./kit.ts";
import { maxEchoedNameChars } from "./limits.ts";
import { toResultText } from "./result.ts";
import { toIntegrationTool } from "./tools.ts";

/**
 * One workspace's connection to its MCP server: the server's tools, listed
 * fresh on every `listTools`, and called by name.
 */
export class McpToolsConnection implements IntegrationConnection {
  readonly #client: McpClient;

  constructor(client: McpClient) {
    this.#client = client;
  }

  /**
   * Asks the server every time, without a cache, so a list the server
   * changed shows up on the next call.
   */
  listTools(): Promise<IntegrationTool[]> {
    return withMcpToolsErrors(async () => {
      const tools = await this.#client.listTools();
      return tools.map(toIntegrationTool);
    });
  }

  /**
   * Calls the server's tool, one request. `signal` cancels the call, and
   * the server is told to stop. A tool that reports its own failure fails
   * the call; its text stays out of our message.
   */
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    return withMcpToolsErrors(async () => {
      const result = await this.#client.callTool(name, args, signal);
      if (result.isError) {
        throw new McpToolsError(
          "tool-failed",
          `The MCP server's tool ${name.slice(0, maxEchoedNameChars)} reported an error.`,
        );
      }
      return toResultText(result);
    });
  }

  close(): Promise<void> {
    return this.#client.close();
  }
}
