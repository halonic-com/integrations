import { z } from "zod";

/**
 * The MCP results we read, tools only (migration checklist K12: resources,
 * prompts and OAuth come later). Each schema describes only the fields we
 * use, so a new field from a newer server doesn't break us.
 * https://modelcontextprotocol.io/specification/2025-11-25/server/tools
 */

/** Protocol versions we speak, newest first. We ask for the first. */
export const supportedProtocolVersions = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

export const initializeResultSchema = z.object({
  protocolVersion: z.string().max(64),
  capabilities: z.object({
    tools: z.object({ listChanged: z.boolean().optional() }).optional(),
  }),
});

/**
 * The spec's rule for tool names, which keeps them safe to show and to
 * match. Halonic's rule for the tools an integration lists is narrower (no
 * `.`, at most 64 characters); an integration that lists tools applies it.
 */
export const toolNamePattern = /^[A-Za-z0-9_.-]{1,128}$/;

export const toolSchema = z.object({
  name: z.string().regex(toolNamePattern),
  description: z.string().max(10_000).optional(),
  inputSchema: z.looseObject({ type: z.literal("object") }),
  // Hints only: a server can claim anything, so they never lower a tool's risk on their own.
  annotations: z
    .object({
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
      openWorldHint: z.boolean().optional(),
    })
    .optional(),
});

/** A tool the server offers, as the server describes it. Its text is the server's. */
export type McpTool = z.infer<typeof toolSchema>;

export const listToolsResultSchema = z.object({
  tools: z.array(toolSchema),
  nextCursor: z.string().max(1024).optional(),
});

const textContentSchema = z.object({ type: z.literal("text"), text: z.string() });
const otherContentSchema = z.object({ type: z.string().max(64) });

export const callToolResultSchema = z.object({
  content: z.array(z.union([textContentSchema, otherContentSchema])),
  isError: z.boolean().optional(),
});

/** One piece of a tool's answer. Images, audio and resources are named, not kept, for now. */
export type McpContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "other"; readonly kind: string };

/** What a tool call returned. `isError` is the tool's own failure, which the model may read. */
export interface McpToolResult {
  readonly content: readonly McpContent[];
  readonly isError: boolean;
}

export function toToolResult(result: z.infer<typeof callToolResultSchema>): McpToolResult {
  const content = result.content.map(
    (item): McpContent =>
      "text" in item ? { type: "text", text: item.text } : { type: "other", kind: item.type },
  );
  return { content, isError: result.isError === true };
}
