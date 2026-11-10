import { z } from "zod";
import { KnowledgeMcpError } from "./errors.ts";

/**
 * The connection's settings and each source's config, checked before any
 * request. Both come from the workspace, so a mistake is the user's to fix:
 * the message names the field, never its value.
 */

/**
 * The connection's settings: which server. Whether it gets a key is not a
 * setting: the kit adds `mcp-server-key` when the workspace has set it up.
 */
export interface ServerSettings {
  /** The server's MCP endpoint. The sheet allows its host and nothing else. */
  readonly url: string;
}

/** One source's names for the server's tools and their arguments. */
export interface SourceConfig {
  readonly searchTool: string;
  readonly queryArg: string;
  /** Without it the source can search but not read documents. */
  readonly getTool?: string | undefined;
  readonly refArg: string;
}

const settingsSchema = z.object({
  // The kit still refuses any host the sheet doesn't allow; this only
  // catches a setting that is no address at all.
  url: z
    .string()
    .max(2_048)
    .regex(/^https?:\/\/[^\s/?#]+[^\s]*$/i),
});

/** The MCP specification's rule for tool names. */
const toolName = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
/** An argument name: a plain identifier, never something that could reach a prototype. */
const argumentName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
  .refine((name) => name !== "__proto__" && name !== "limit");

// `z.object` drops every other field: `url`, `secret` and `headers` in a
// source's config are never read (README).
const sourceConfigSchema = z.object({
  searchTool: toolName,
  queryArg: argumentName.default("query"),
  getTool: toolName.optional(),
  refArg: argumentName.default("ref"),
});

/**
 * @param integration - the sheet's `id`, which the message names
 * @throws {KnowledgeMcpError} `bad-config`, naming the fields to fix
 */
export function readSettings(
  settings: Readonly<Record<string, unknown>>,
  integration: string,
): ServerSettings {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) {
    throw badConfig(`the ${integration} settings`, parsed.error);
  }
  return parsed.data;
}

/** @throws {KnowledgeMcpError} `bad-config`, naming the fields to fix */
export function readSourceConfig(sourceId: string, config: Record<string, unknown>): SourceConfig {
  const parsed = sourceConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw badConfig(`the config of knowledge source ${sourceId.slice(0, 64)}`, parsed.error);
  }
  return parsed.data;
}

function badConfig(what: string, error: z.ZodError): KnowledgeMcpError {
  // Name the fields, never their values (guide, section 7, rule 8).
  const fields = [...new Set(error.issues.map((issue) => issue.path.join(".") || "(all)"))];
  return new KnowledgeMcpError("bad-config", `Check ${what}: ${fields.join(", ")}.`);
}
