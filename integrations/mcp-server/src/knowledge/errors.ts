import { McpError, type McpErrorCode } from "@halonicjs/integration-mcp";

/**
 * What went wrong searching or reading an MCP knowledge source (guide,
 * section 7). The MCP client's codes, plus:
 *
 * - `bad-config`: the workspace's settings or the source's config are
 *   missing or wrong, so no request was sent;
 * - `tool-failed`: the server's tool reported its own failure (`isError`).
 */
export type KnowledgeMcpErrorCode = McpErrorCode | "bad-config" | "tool-failed";

/**
 * The knowledge source's one error type. Its message is ours, written for
 * the user: never the server's text, which a hostile server can fill with
 * anything.
 */
export class KnowledgeMcpError extends Error {
  override readonly name = "KnowledgeMcpError";
  readonly code: KnowledgeMcpErrorCode;

  constructor(code: KnowledgeMcpErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Runs `work` and turns the MCP client's errors into ours, with the same
 * code and message: the client's messages are already ours and safe to
 * show. Only `session-expired` gets its own message: the next search opens
 * a new session by itself, so the user only has to try again. Every other
 * error, such as the kit's `IntegrationRefusedError` or its timeout, passes
 * through unchanged (guide, section 7, rule 7).
 */
export async function withKnowledgeErrors<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof McpError && error.code === "session-expired") {
      throw new KnowledgeMcpError(error.code, "The MCP server ended the session. Try again.");
    }
    if (error instanceof McpError) {
      throw new KnowledgeMcpError(error.code, error.message);
    }
    throw error;
  }
}
