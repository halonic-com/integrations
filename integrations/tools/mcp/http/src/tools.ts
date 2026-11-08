import type { McpTool } from "@halonicjs/integration-mcp";
import { cutText } from "@halonicjs/integration-shared";
import { McpToolsError } from "./errors.ts";
import type { IntegrationTool } from "./kit.ts";
import { maxDescriptionChars, maxParametersChars } from "./limits.ts";

/**
 * One of the server's tools, as Halonic offers it to agents. The name,
 * description and argument schema are the server's; the risk and
 * `untrusted` are ours.
 *
 * - `risk` is always `write`: Halonic treats a tool the sheet doesn't
 *   declare as `write` anyway. The server's hints, such as `readOnlyHint`,
 *   never lower it: a server can claim anything.
 * - `untrusted` is always `true`: every result is the server's text.
 *
 * @throws {McpToolsError} `unexpected-response` for an argument schema above {@link maxParametersChars}
 */
export function toIntegrationTool(tool: McpTool): IntegrationTool {
  if (JSON.stringify(tool.inputSchema).length > maxParametersChars) {
    // The name follows the specification's pattern, so it is safe to show.
    throw new McpToolsError(
      "unexpected-response",
      `The MCP server's tool ${tool.name} describes its arguments in more than ${maxParametersChars} characters.`,
    );
  }
  return {
    name: tool.name,
    description: cutText(tool.description ?? "", maxDescriptionChars),
    parameters: tool.inputSchema,
    risk: "write",
    untrusted: true,
  };
}
