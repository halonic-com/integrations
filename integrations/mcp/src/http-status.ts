import { McpError } from "./errors.ts";

/**
 * Maps an HTTP error status from the MCP server to our error, the same way
 * as every integration (guide, section 7). The body is never read: it is
 * the server's text.
 *
 * @param hasSession whether we sent an `Mcp-Session-Id`: then `404` means
 *   the server forgot the session, not that the address is wrong
 */
export function errorForStatus(status: number, hasSession: boolean): McpError {
  switch (status) {
    case 400:
    case 422:
      return new McpError("bad-arguments", "The MCP server refused the request.");
    case 401:
      return new McpError(
        "not-signed-in",
        "The MCP server refused the key. Check the key or reconnect.",
      );
    case 403:
      return new McpError("not-allowed", "The MCP server doesn't allow this account to do that.");
    case 404:
      return hasSession
        ? new McpError("session-expired", "The MCP server ended the session. Connect again.")
        : new McpError("not-found", "There is no MCP server at this address.");
    case 408:
    case 429:
      return new McpError("rate-limited", "The MCP server is busy. Try again later.");
    default:
      return new McpError("unavailable", "The MCP server is having trouble.");
  }
}
