import type { IntegrationTool } from "@halonicjs/adapters/integration-kit";
import type { McpTool } from "@halonicjs/integration-mcp";
import { cutText } from "@halonicjs/integration-shared";
import { McpToolsError } from "./errors.ts";
import {
  maxDescriptionChars,
  maxParametersChars,
  maxParametersDepth,
  maxToolListChars,
  maxUnfencedChars,
} from "./limits.ts";
import { listedToolNamePattern, withListedNames } from "./listed-names.ts";

/**
 * The server's tool list, as Halonic offers it to agents.
 *
 * Leaves out a tool whose name doesn't match {@link listedToolNamePattern},
 * or that {@link toIntegrationTool} leaves out, as Halonic would: offering
 * it would only get it refused there, one tool at a time. The other tools
 * stay usable.
 *
 * Refuses the whole list, rather than leaving tools out, when a name
 * repeats or the list is above {@link maxToolListChars}: an agent should
 * see the server's tools as they are, or none of them.
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
  for (const tool of tools.filter((tool) => listedToolNamePattern.test(tool.name))) {
    if (seen.has(tool.name)) {
      throw new McpToolsError(
        "unexpected-response",
        `The MCP server lists its tool ${tool.name} more than once.`,
      );
    }
    seen.add(tool.name);
    const integrationTool = toIntegrationTool(tool);
    if (integrationTool === undefined) {
      continue;
    }
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
 * - Strings a call sends back follow Halonic's name rule (see
 *   {@link withListedNames}): the schema loses an `enum` or `const` that
 *   breaks it.
 *
 * @returns `undefined` for a tool Halonic would refuse: its name or a name
 *   in its schema breaks the rule, or its unfenced strings add up to more
 *   than {@link maxUnfencedChars} characters
 * @throws {McpToolsError} `unexpected-response` for an argument schema
 *   nested deeper than {@link maxParametersDepth} or above {@link maxParametersChars}
 */
export function toIntegrationTool(tool: McpTool): IntegrationTool | undefined {
  // Checked first: the size check and the copy below walk the schema
  // recursively, and a deep enough one overflows the stack.
  if (nestsDeeperThan(tool.inputSchema, maxParametersDepth)) {
    throw new McpToolsError(
      "unexpected-response",
      `The MCP server's tool ${tool.name} nests its arguments more than ${maxParametersDepth} levels deep.`,
    );
  }
  if (JSON.stringify(tool.inputSchema).length > maxParametersChars) {
    throw new McpToolsError(
      "unexpected-response",
      `The MCP server's tool ${tool.name} describes its arguments in more than ${maxParametersChars} characters.`,
    );
  }
  const listed = withListedNames(tool.inputSchema);
  if (!listedToolNamePattern.test(tool.name) || listed === undefined) {
    return undefined;
  }
  const unfencedChars = [tool.name, ...listed.unfencedStrings].join("").length;
  if (unfencedChars > maxUnfencedChars) {
    return undefined;
  }
  return {
    name: tool.name,
    description: cutText(withoutHiddenText(tool.description ?? ""), maxDescriptionChars),
    parameters: withoutHiddenSchemaText(listed.schema),
    risk: "write",
    untrusted: true,
  };
}

/**
 * Whether `value` nests objects and arrays more than `maxDepth` levels
 * deep. Walks with its own list rather than recursion, so any depth is
 * safe to check.
 */
function nestsDeeperThan(value: unknown, maxDepth: number): boolean {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next.value !== "object" || next.value === null) {
      continue;
    }
    const depth = next.depth + 1;
    if (depth > maxDepth) {
      return true;
    }
    for (const child of Object.values(next.value)) {
      pending.push({ value: child, depth });
    }
  }
  return false;
}

/**
 * Format characters (zero-width characters, direction marks, the invisible
 * "tag" letters), variation selectors, and control characters other than
 * line breaks and tabs. A person reading the tool list can't see them, but
 * the model reads them, so a server could hide instructions in them.
 * Variation selectors aren't format characters, but a run of them after a
 * visible character can carry hidden bytes.
 */
const hiddenText = /(?![\n\t])[\p{Cc}\p{Cf}]|[\u{FE00}-\u{FE0F}]|[\u{E0100}-\u{E01EF}]/gu;

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
  // Built with `fromEntries`, which always makes own keys: assigning a
  // `__proto__` key would set the copy's prototype and lose the key.
  const copy = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => {
      const isText = (key === "description" || key === "title") && typeof value === "string";
      return [key, isText ? withoutHiddenText(value) : withoutHiddenSchemaText(value)];
    }),
  );
  return copy as Schema;
}
