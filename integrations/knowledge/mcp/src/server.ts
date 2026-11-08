import {
  McpError,
  type McpHost,
  McpSession,
  type McpToolResult,
  StreamableHttpTransport,
} from "@halonicjs/integration-mcp";
import type { SecretPlacement } from "@halonicjs/integration-shared";
import { readSettings } from "./config.ts";
import { KnowledgeMcpError } from "./errors.ts";

/** The secret the sheet declares; the kit adds its value, which we never see. */
const serverKey: SecretPlacement = { secret: "mcp-server-key", as: "bearer" };

/** How we introduce ourselves to the server. */
const clientInfo = { name: "halonic-knowledge-mcp", version: "0.1.0" };

/**
 * The connection's one MCP server, shared by all its knowledge sources.
 *
 * Opens the session on the first call, not before: `connect` must send
 * nothing. Calls that come in while it opens wait for the same session. A
 * session that fails to open, or that the server ends, is dropped, so the
 * next call opens a new one; the failed call itself is never repeated.
 * After `close`, calls are refused, so no session opens that nobody ends.
 */
export class McpServer {
  readonly #host: McpHost;
  readonly #settings: Readonly<Record<string, unknown>>;
  #session: Promise<McpSession> | undefined;
  #closed = false;

  constructor(host: McpHost, settings: Readonly<Record<string, unknown>>) {
    this.#host = host;
    this.#settings = settings;
  }

  /**
   * Calls one of the server's tools. One request, plus the two of the
   * handshake on the first call (guide, section 4, rule 9).
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const opening = this.#open();
    const session = await opening;
    try {
      return await session.callTool(name, args);
    } catch (error) {
      if (error instanceof McpError && error.code === "session-expired") {
        this.#forget(opening);
      }
      throw error;
    }
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

  #open(): Promise<McpSession> {
    if (this.#closed) {
      return Promise.reject(
        new KnowledgeMcpError("unavailable", "The connection to the MCP server is closed."),
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
    const settings = readSettings(this.#settings);
    const transport = new StreamableHttpTransport(this.#host, {
      url: settings.url,
      auth: serverKey,
    });
    const session = new McpSession(transport, { clientInfo });
    try {
      const agreement = await session.initialize();
      if (!agreement.offersTools) {
        throw new KnowledgeMcpError("not-found", "The MCP server offers no tools to search with.");
      }
      return session;
    } catch (error) {
      // The server may already keep a session for us: end it, but report the first error.
      await session.close().catch(() => undefined);
      throw error;
    }
  }
}
