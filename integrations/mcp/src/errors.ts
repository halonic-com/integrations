/**
 * What went wrong talking to an MCP server (guide, section 7). The first
 * codes are the guide's; the MCP ones:
 *
 * - `unsupported-version`: the server speaks no protocol version we do;
 * - `session-expired`: the server forgot the session; connect again.
 */
export type McpErrorCode =
  | "bad-arguments"
  | "not-signed-in"
  | "not-allowed"
  | "not-found"
  | "rate-limited"
  | "unavailable"
  | "unexpected-response"
  | "unsupported-version"
  | "session-expired";

/**
 * The MCP client's one error type. Its message is ours, written for the
 * user: never the server's text, which a hostile server can fill with
 * anything.
 */
export class McpError extends Error {
  override readonly name = "McpError";
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** The server answered with something we can't read. */
export function unexpectedResponse(): McpError {
  return new McpError("unexpected-response", "The MCP server answered in an unexpected way.");
}
