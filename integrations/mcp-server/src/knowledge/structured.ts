import type { McpToolResult } from "@halonicjs/integration-mcp";
import { z } from "zod";

/**
 * Reading structure out of a tool's text. MCP tools answer with text; a
 * tool that has structured results sends them as JSON in that text, and
 * the specification asks servers that send `structuredContent` to repeat
 * it there
 * (https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content).
 */

/** A JSON object, as the server sent it. Its fields are read with {@link stringField}. */
export type JsonObject = Readonly<Record<string, unknown>>;

const jsonObjectSchema = z.record(z.string(), z.unknown());

/** The text parts of a tool's answer, in order. Images and other parts are left out. */
export function textsOf(result: McpToolResult): string[] {
  return result.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
}

/** `text` parsed as JSON, or `undefined` when it isn't JSON. A parse error never leaves. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `value` when it is a JSON object (not a list), otherwise `undefined`. */
export function asJsonObject(value: unknown): JsonObject | undefined {
  if (Array.isArray(value)) {
    return undefined;
  }
  const parsed = jsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The first of `names` that `object` holds as a non-empty string. A number
 * counts too when `numbers` is set, for ids such as `42`. Only the object's
 * own fields are read, so a name such as `constructor` never finds a
 * function (guide, section 5).
 */
export function stringField(
  object: JsonObject,
  names: readonly string[],
  numbers = false,
): string | undefined {
  for (const name of names) {
    if (!Object.hasOwn(object, name)) {
      continue;
    }
    const value = object[name];
    if (typeof value === "string" && value !== "") {
      return value;
    }
    if (numbers && typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}
