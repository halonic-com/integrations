import type { AbortSignalLike } from "@halonicjs/integration-shared";
import type { OutgoingMessage } from "./json-rpc.ts";

/**
 * Carries JSON-RPC messages between the session and one MCP server. The
 * session doesn't know how; the streamable HTTP transport is one way.
 */
export interface McpTransport {
  /**
   * Sends one message. For a request, yields every message the server
   * sends while answering it, as unchecked JSON values, and ends after the
   * answer. For a notification or a response, yields nothing.
   *
   * @throws {McpError} when the server can't be reached or refuses the message
   */
  send(message: OutgoingMessage, signal?: AbortSignalLike): AsyncIterable<unknown>;

  /** Called once the version is agreed; HTTP sends it with every later request. */
  useProtocolVersion(version: string): void;

  /** Ends the session on the server, if it keeps one. */
  close(signal?: AbortSignalLike): Promise<void>;
}
