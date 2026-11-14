import type { IntegrationConnection, IntegrationTool } from "@halonicjs/adapters/integration-kit";
import { type McpClient, toolNamePattern } from "@halonicjs/integration-mcp";
import { McpToolsError, withMcpToolsErrors } from "./errors.ts";
import { toResultText } from "./result.ts";
import { toIntegrationTools } from "./tools.ts";

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
      return toIntegrationTools(tools);
    });
  }

  /**
   * Calls the server's tool, one request. `signal` cancels the call, and
   * the server is told to stop. A tool that reports its own failure fails
   * the call; its text stays out of our message, and so does a name
   * outside the specification's pattern, which the caller may have made up.
   */
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    return withMcpToolsErrors(async () => {
      const result = await this.#client.callTool(name, args, signal);
      if (result.isError) {
        const tool = toolNamePattern.test(name) ? `tool ${name}` : "tool";
        throw new McpToolsError("tool-failed", `The MCP server's ${tool} reported an error.`);
      }
      return toResultText(result);
    });
  }

  close(): Promise<void> {
    return this.#client.close();
  }
}
