import type { AbortSignalLike } from "@halonicjs/integration-shared";
import type { z } from "zod";
import { McpError, unexpectedResponse } from "./errors.ts";
import {
  errorCodes,
  errorForRpcCode,
  type IncomingMessage,
  parseIncoming,
  type RequestId,
} from "./json-rpc.ts";
import {
  callToolResultSchema,
  initializeResultSchema,
  listToolsResultSchema,
  type McpTool,
  type McpToolResult,
  supportedProtocolVersions,
  toToolResult,
} from "./protocol.ts";
import type { McpTransport } from "./transport.ts";

/** How Halonic introduces itself to the server. */
export interface ClientInfo {
  readonly name: string;
  readonly version: string;
}

export interface McpSessionOptions {
  readonly clientInfo: ClientInfo;
  /** Called when the server says its list of tools changed. */
  readonly onToolsChanged?: () => void;
}

/** What the server agreed to in `initialize`. */
export interface ServerAgreement {
  readonly protocolVersion: string;
  readonly offersTools: boolean;
  readonly announcesToolChanges: boolean;
}

/**
 * Tool lists go into the model's context, so we read at most this many,
 * in at most this many pages (guide, section 4, rule 9).
 */
export const maxTools = 200;
export const maxToolPages = 10;

/**
 * One conversation with one MCP server: the `initialize` handshake, then
 * `tools/list` and `tools/call`. It matches each answer to its request by
 * id, answers the server's `ping`, and refuses every other request from
 * the server, because we offer no client capabilities yet.
 */
export class McpSession {
  readonly #transport: McpTransport;
  readonly #options: McpSessionOptions;
  #nextId = 1;
  #agreement: ServerAgreement | undefined;

  constructor(transport: McpTransport, options: McpSessionOptions) {
    this.#transport = transport;
    this.#options = options;
  }

  /**
   * Agrees on a protocol version and the server's capabilities. Call it
   * once, before anything else.
   *
   * @throws {McpError} `unsupported-version` when the server speaks none of ours
   */
  async initialize(signal?: AbortSignalLike): Promise<ServerAgreement> {
    const result = await this.#request(
      "initialize",
      {
        protocolVersion: supportedProtocolVersions[0],
        capabilities: {},
        clientInfo: this.#options.clientInfo,
      },
      initializeResultSchema,
      signal,
    );
    // The version is the server's text: compare it with ours, never repeat it.
    const version = supportedProtocolVersions.find(
      (supported) => supported === result.protocolVersion,
    );
    if (version === undefined) {
      throw new McpError(
        "unsupported-version",
        "The MCP server speaks a protocol version Halonic doesn't support.",
      );
    }
    this.#transport.useProtocolVersion(version);
    this.#agreement = {
      protocolVersion: version,
      offersTools: result.capabilities.tools !== undefined,
      announcesToolChanges: result.capabilities.tools?.listChanged === true,
    };
    await this.#drain(
      this.#transport.send({ jsonrpc: "2.0", method: "notifications/initialized" }, signal),
    );
    return this.#agreement;
  }

  /**
   * Lists the server's tools, following pages: at most {@link maxToolPages}
   * requests and {@link maxTools} tools.
   */
  async listTools(signal?: AbortSignalLike): Promise<McpTool[]> {
    if (!this.#initialized().offersTools) {
      return [];
    }
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxToolPages; page += 1) {
      const params = cursor === undefined ? {} : { cursor };
      const result = await this.#request("tools/list", params, listToolsResultSchema, signal);
      tools.push(...result.tools);
      if (tools.length > maxTools) {
        throw new McpError(
          "unexpected-response",
          `The MCP server offers more than ${maxTools} tools.`,
        );
      }
      cursor = result.nextCursor;
      if (cursor === undefined) {
        return tools;
      }
    }
    throw new McpError(
      "unexpected-response",
      `The MCP server lists its tools in more than ${maxToolPages} pages.`,
    );
  }

  /**
   * Calls one tool. A tool that fails on its own terms returns `isError`;
   * a refused call throws. Never retried: a tool can send or delete.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignalLike,
  ): Promise<McpToolResult> {
    this.#initialized();
    const result = await this.#request(
      "tools/call",
      { name, arguments: args },
      callToolResultSchema,
      signal,
    );
    return toToolResult(result);
  }

  /** Ends the session on the server. */
  async close(signal?: AbortSignalLike): Promise<void> {
    await this.#transport.close(signal);
  }

  #initialized(): ServerAgreement {
    if (this.#agreement === undefined) {
      throw new Error("Call initialize() before using the MCP session.");
    }
    return this.#agreement;
  }

  /**
   * Sends one request and reads the server's messages until its answer.
   * When the caller aborts, it tells the server to stop working on it.
   */
  async #request<Schema extends z.ZodType>(
    method: string,
    params: Record<string, unknown>,
    schema: Schema,
    signal: AbortSignalLike | undefined,
  ): Promise<z.infer<Schema>> {
    const id = this.#nextId;
    this.#nextId += 1;
    try {
      for await (const value of this.#transport.send(
        { jsonrpc: "2.0", id, method, params },
        signal,
      )) {
        const message = parseIncoming(value);
        const answer = await this.#handle(message, id, method, signal);
        if (answer !== undefined) {
          const parsed = schema.safeParse(answer);
          if (!parsed.success) {
            throw unexpectedResponse();
          }
          return parsed.data;
        }
      }
      // The transport ended without an answer, even after any resume it tries.
      throw new McpError("unavailable", `The MCP server stopped before it answered ${method}.`);
    } catch (error) {
      // The protocol forbids cancelling `initialize`.
      if (signal?.aborted === true && method !== "initialize") {
        this.#sendCancelled(id);
      }
      throw error;
    }
  }

  /**
   * Tells the server we no longer want the answer to request `id`, so it
   * can stop the work
   * (https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation).
   * The caller's signal is already aborted, so this goes without it, and
   * nobody waits for it: the kit's timeout ends it. It is only a courtesy,
   * so a failure changes nothing for the caller.
   */
  #sendCancelled(id: number): void {
    this.#drain(
      this.#transport.send({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: id, reason: "The caller cancelled the request." },
      }),
    ).catch(() => undefined);
  }

  /** @returns the result when `message` answers request `id`, otherwise `undefined` */
  async #handle(
    message: IncomingMessage,
    id: number,
    method: string,
    signal: AbortSignalLike | undefined,
  ): Promise<Record<string, unknown> | undefined> {
    switch (message.kind) {
      case "result":
        // An answer to another id is stale or confused; it must not answer this one.
        return message.id === id ? message.result : undefined;
      case "error":
        // `null` is the id of an answer to a request the server couldn't read: ours.
        if (message.id === id || message.id === null) {
          throw errorForRpcCode(message.code, method);
        }
        return undefined;
      case "request":
        await this.#answerServerRequest(message.id, message.method, signal);
        return undefined;
      case "notification":
        if (message.method === "notifications/tools/list_changed") {
          this.#options.onToolsChanged?.();
        }
        return undefined;
    }
  }

  async #answerServerRequest(
    id: RequestId,
    method: string,
    signal: AbortSignalLike | undefined,
  ): Promise<void> {
    const answer =
      method === "ping"
        ? { jsonrpc: "2.0" as const, id, result: {} }
        : {
            jsonrpc: "2.0" as const,
            id,
            error: { code: errorCodes.methodNotFound, message: "Method not found" },
          };
    await this.#drain(this.#transport.send(answer, signal));
  }

  /** Sends a message that gets no answer; the transport yields nothing for it. */
  async #drain(messages: AsyncIterable<unknown>): Promise<void> {
    for await (const _message of messages) {
      // A notification or a response has no answer to read.
    }
  }
}
