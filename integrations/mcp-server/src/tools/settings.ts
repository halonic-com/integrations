import { z } from "zod";
import { McpToolsError } from "./errors.ts";

/**
 * The connection's settings, checked before any request. They come from
 * the workspace, so a mistake is the user's to fix: the message names the
 * field, never its value. Whether the server gets a key is not a setting:
 * the kit adds `mcp-server-key` when the workspace has set it up.
 */
export interface ServerSettings {
  /** The server's MCP endpoint. The sheet allows its host and nothing else. */
  readonly url: string;
}

const settingsSchema = z.object({
  // The kit still refuses any host the sheet doesn't allow; this only
  // catches a setting that is no address at all.
  url: z
    .string()
    .max(2_048)
    .regex(/^https?:\/\/[^\s/?#]+[^\s]*$/i),
});

/**
 * @param integration - the sheet's `id`, which the message names
 * @throws {McpToolsError} `bad-config`, naming the fields to fix
 */
export function readSettings(
  settings: Readonly<Record<string, unknown>>,
  integration: string,
): ServerSettings {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(all)")),
    ];
    throw new McpToolsError(
      "bad-config",
      `Check the ${integration} settings: ${fields.join(", ")}.`,
    );
  }
  return parsed.data;
}
