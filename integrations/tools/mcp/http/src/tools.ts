import type { McpTool } from "@halonicjs/integration-mcp";
import { cutText } from "@halonicjs/integration-shared";
import { McpToolsError } from "./errors.ts";
import type { IntegrationTool } from "./kit.ts";
import { maxDescriptionChars, maxParametersChars, maxToolListChars } from "./limits.ts";

/**
 * The server's tool list, as Halonic offers it to agents. Refuses the
 * whole list, rather than leaving tools out, when a name repeats or the
 * list is above {@link maxToolListChars}: an agent should see the server's
 * tools as they are, or none of them.
 *
 * A tool's name follows the specification's pattern, so it is safe to
 * show in our messages.
 *
 * @throws {McpToolsError} `unexpected-response` for a repeated name, a list
 *   above its limit, or a tool {@link toIntegrationTool} refuses
 */
export function toIntegrationTools(tools: readonly McpTool[]): IntegrationTool[] {
  const seen = new Set<string>();
  let listChars = 0;
  const offered: IntegrationTool[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new McpToolsError(
        "unexpected-response",
        `The MCP server lists its tool ${tool.name} more than once.`,
      );
    }
    seen.add(tool.name);
    const integrationTool = toIntegrationTool(tool);
    listChars += integrationTool.description.length;
    listChars += JSON.stringify(integrationTool.parameters).length;
    if (listChars > maxToolListChars) {
      throw new McpToolsError(
        "unexpected-response",
        `The MCP server's tools take more than ${maxToolListChars} characters to describe.`,
      );
    }
    offered.push(integrationTool);
  }
  return offered;
}

/**
 * One of the server's tools, as Halonic offers it to agents. The name,
 * description and argument schema are the server's; the risk and
 * `untrusted` are ours.
 *
 * - `risk` is always `write`: Halonic treats a tool the sheet doesn't
 *   declare as `write` anyway. The server's hints, such as `readOnlyHint`,
 *   never lower it: a server can claim anything.
 * - `untrusted` is always `true`: every result is the server's text.
 * - The descriptions, the tool's and those in its schema, lose the
 *   characters a person can't see (see {@link withoutHiddenText}). They
 *   still reach the model as the server wrote them otherwise.
 *
 * @throws {McpToolsError} `unexpected-response` for an argument schema above {@link maxParametersChars}
 */
export function toIntegrationTool(tool: McpTool): IntegrationTool {
  if (JSON.stringify(tool.inputSchema).length > maxParametersChars) {
    throw new McpToolsError(
      "unexpected-response",
      `The MCP server's tool ${tool.name} describes its arguments in more than ${maxParametersChars} characters.`,
    );
  }
  return {
    name: tool.name,
    description: cutText(withoutHiddenText(tool.description ?? ""), maxDescriptionChars),
    parameters: withoutHiddenSchemaText(tool.inputSchema),
    risk: "write",
    untrusted: true,
  };
}

/**
 * Format characters (zero-width characters, direction marks, the invisible
 * "tag" letters) and control characters other than line breaks and tabs.
 * A person reading the tool list can't see them, but the model reads them,
 * so a server could hide instructions in them.
 */
const hiddenText = /(?![\n\t])[\p{Cc}\p{Cf}]/gu;

/** `text` without the characters a person can't see. */
export function withoutHiddenText(text: string): string {
  return text.replace(hiddenText, "");
}

/**
 * A copy of an argument schema whose `description` and `title` texts, at
 * any depth, lose the characters a person can't see. Everything else, such
 * as property names and patterns, stays as the server wrote it: the
 * server checks the arguments against it.
 */
function withoutHiddenSchemaText<Schema>(schema: Schema): Schema {
  if (Array.isArray(schema)) {
    return schema.map(withoutHiddenSchemaText) as Schema;
  }
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    const isText = (key === "description" || key === "title") && typeof value === "string";
    copy[key] = isText ? withoutHiddenText(value) : withoutHiddenSchemaText(value);
  }
  return copy as Schema;
}
