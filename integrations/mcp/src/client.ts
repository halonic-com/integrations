import { McpError } from "./errors.ts";
import type { McpTool, McpToolResult } from "./protocol.ts";
import { type ClientInfo, McpSession, type ServerAgreement } from "./session.ts";
import type { McpTransport } from "./transport.ts";

export interface McpClientOptions {
  /**
   * Builds the transport for a new session. Called on the first call and
   * again after a session ended, never in the constructor, so it may read
   * the workspace's settings and throw when they are wrong.
   */
  readonly openTransport: () => McpTransport;
  readonly clientInfo: ClientInfo;
  /**
   * Checks what the server agreed to before the new session is used, such
   * as whether it offers tools at all. Throw to refuse the session; it is
   * then ended on the server.
   */
  readonly checkAgreement?: (agreement: ServerAgreement) => void;
}

/**
 * One integration's connection to one MCP server.
 *
 * Opens the session on the first call, not before: an integration's
 * `connect` must send nothing. Calls that come in while it opens wait for
 * the same session. A session that fails to open, or that the server ends,
 * is dropped, so the next call opens a new one; the failed call itself is
 * never repeated. After `close`, calls are refused, so no session opens
 * that nobody ends.
 *
 * The session opens without the caller's signal: other calls may be
 * waiting for it, so one caller cancelling must not fail theirs. The kit's
 * timeout still ends a handshake that hangs.
 */
export class McpClient {
  readonly #options: McpClientOptions;
  #session: Promise<McpSession> | undefined;
  #closed = false;

  constructor(options: McpClientOptions) {
    this.#options = options;
  }

  /**
   * Lists the server's tools now. At most `maxToolPages` requests, plus
   * the two of the handshake when no session is open.
   */
  listTools(signal?: AbortSignal): Promise<McpTool[]> {
    return this.#inSession((session) => session.listTools(signal));
  }

  /**
   * Calls one of the server's tools. One request, plus the two of the
   * handshake when no session is open (guide, section 4, rule 9).
   */
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    return this.#inSession((session) => session.callTool(name, args, signal));
  }

  /** Ends the session on the server, if one is open. Safe to call twice. */
  async close(): Promise<void> {
    this.#closed = true;
    const opening = this.#session;
    this.#session = undefined;
    if (opening === undefined) {
      return;
    }
    let session: McpSession;
    try {
      session = await opening;
    } catch {
      // It never opened, so there is nothing to end.
      return;
    }
    await session.close();
  }

  async #inSession<Result>(work: (session: McpSession) => Promise<Result>): Promise<Result> {
    const opening = this.#open();
    const session = await opening;
    try {
      return await work(session);
    } catch (error) {
      if (error instanceof McpError && error.code === "session-expired") {
        this.#forget(opening);
      }
      throw error;
    }
  }

  #open(): Promise<McpSession> {
    if (this.#closed) {
      return Promise.reject(
        new McpError("unavailable", "The connection to the MCP server is closed."),
      );
    }
    if (this.#session === undefined) {
      const opening = this.#start();
      this.#session = opening;
      opening.catch(() => this.#forget(opening));
    }
    return this.#session;
  }

  /**
   * Drops `opening`, unless a newer session has already replaced it: a late
   * failure from an old session must not drop the one that works now.
   */
  #forget(opening: Promise<McpSession>): void {
    if (this.#session === opening) {
      this.#session = undefined;
    }
  }

  async #start(): Promise<McpSession> {
    const session = new McpSession(this.#options.openTransport(), {
      clientInfo: this.#options.clientInfo,
    });
    try {
      const agreement = await session.initialize();
      this.#options.checkAgreement?.(agreement);
      return session;
    } catch (error) {
      // The server may already keep a session for us: end it, but report the first error.
      await session.close().catch(() => undefined);
      throw error;
    }
  }
}
