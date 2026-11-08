import {
  type AbortSignalLike,
  type ByteStream,
  EventStream,
  EventStreamError,
  type HttpClient,
  type HttpResponse,
  type SecretPlacement,
} from "@halonicjs/integration-shared";
import { McpError, unexpectedResponse } from "./errors.ts";
import { errorForStatus } from "./http-status.ts";
import type { JsonRpcRequest, OutgoingMessage } from "./json-rpc.ts";
import type { McpTransport } from "./transport.ts";

export interface StreamableHttpOptions {
  /** The server's MCP endpoint, from the workspace's settings. */
  readonly url: string;
  /** Where the kit puts the server's key, if it needs one. */
  readonly auth?: SecretPlacement;
}

/**
 * How often in a row one request may resume its answer stream without
 * getting a new event. Resuming is a `GET` that changes nothing, so it is
 * safe to repeat, but never without end (guide, section 4, rules 9 and 10).
 * A resume that brings a new event id starts the count again: a server on
 * 2025-11-25 may close the stream on purpose during a long call and expect
 * us to come back.
 */
export const maxResumesWithoutProgress = 3;

/**
 * How often one request may resume its answer stream in total, progress or
 * not. Without it, a server that sends a new id and closes the stream every
 * time would get a new `GET` from us without end, with no pause in between
 * (guide, section 4, rule 9, and section 10, rule 9). Ten leaves room for a
 * long call the server closes on purpose a few times, and keeps the number
 * of requests in one call small.
 */
export const maxResumesPerRequest = 10;

/**
 * The streamable HTTP transport
 * (https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http).
 *
 * Every message is a `POST` to one endpoint. The server answers a request
 * with one JSON message or with an event stream that carries its own
 * requests and notifications before the answer. It may hand out a session
 * id, which we send back with every later message.
 *
 * When an answer stream ends or drops before the answer, and the server
 * gave its events ids, we resume with a `GET` and `Last-Event-ID`, until
 * {@link maxResumesWithoutProgress} resumes in a row brought no new event,
 * and never more than {@link maxResumesPerRequest} times in all.
 * A server that wants a pause first (`retry:`) gets none: the kit has no
 * timer for integrations yet.
 */
export class StreamableHttpTransport implements McpTransport {
  readonly #http: HttpClient;
  readonly #options: StreamableHttpOptions;
  #sessionId: string | undefined;
  #protocolVersion: string | undefined;

  constructor(http: HttpClient, options: StreamableHttpOptions) {
    this.#http = http;
    this.#options = options;
  }

  async *send(message: OutgoingMessage, signal?: AbortSignalLike): AsyncGenerator<unknown> {
    const response = await this.#fetch(
      "POST",
      { "content-type": "application/json" },
      JSON.stringify(message),
      signal,
    );
    this.#throwUnlessOk(response);
    this.#rememberSession(response, message);
    if (!isRequest(message)) {
      // A notification or a response: the server only confirms it got it (202).
      return;
    }
    const contentType = mediaType(response);
    if (contentType === "application/json") {
      yield parseJson(await response.text());
    } else if (contentType === "text/event-stream" && response.body !== null) {
      yield* this.#readAnswerStream(response.body, message.id, signal);
    } else {
      throw unexpectedResponse();
    }
  }

  useProtocolVersion(version: string): void {
    this.#protocolVersion = version;
  }

  async close(signal?: AbortSignalLike): Promise<void> {
    if (this.#sessionId === undefined) {
      return;
    }
    const response = await this.#fetch("DELETE", {}, undefined, signal);
    this.#sessionId = undefined;
    // 404: the session is already gone. 405: the server doesn't let clients
    // end sessions and ends them itself. Both are fine.
    if (!response.ok && response.status !== 404 && response.status !== 405) {
      throw errorForStatus(response.status, false);
    }
  }

  /**
   * Yields the messages of an answer stream until the answer to `id`,
   * resuming the stream when it ends or drops too early.
   */
  async *#readAnswerStream(firstBody: ByteStream, id: number, signal: AbortSignalLike | undefined) {
    let body = firstBody;
    // The id of the last complete event over all streams of this request.
    let lastEventId = "";
    let resumesWithoutProgress = 0;
    let resumes = 0;
    while (true) {
      const events = new EventStream(body);
      let drop: { readonly error: unknown } | undefined;
      try {
        for await (const message of messagesIn(events)) {
          yield message;
          if (isAnswerTo(message, id)) return;
        }
      } catch (error) {
        if (error instanceof McpError) throw error;
        drop = { error };
      }
      if (events.lastEventId !== "" && events.lastEventId !== lastEventId) {
        lastEventId = events.lastEventId;
        resumesWithoutProgress = 0;
      }
      const canResume =
        lastEventId !== "" &&
        resumesWithoutProgress < maxResumesWithoutProgress &&
        resumes < maxResumesPerRequest &&
        signal?.aborted !== true;
      if (!canResume) {
        // Errors from the kit, such as its timeout, pass through unchanged
        // (guide, section 7, rule 7). A stream that just ended makes the
        // session say the server stopped before it answered.
        if (drop !== undefined) throw drop.error;
        return;
      }
      resumesWithoutProgress += 1;
      resumes += 1;
      body = await this.#resume(lastEventId, signal);
    }
  }

  /** Asks the server to send the rest of the stream, after the event with this id. */
  async #resume(lastEventId: string, signal: AbortSignalLike | undefined): Promise<ByteStream> {
    const response = await this.#fetch("GET", { "last-event-id": lastEventId }, undefined, signal);
    this.#throwUnlessOk(response);
    if (mediaType(response) !== "text/event-stream" || response.body === null) {
      throw unexpectedResponse();
    }
    return response.body;
  }

  /** Sends one HTTP request with the headers every MCP message needs. */
  async #fetch(
    method: string,
    extraHeaders: Record<string, string>,
    body: string | undefined,
    signal: AbortSignalLike | undefined,
  ): Promise<HttpResponse> {
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    };
    if (this.#sessionId !== undefined) headers["mcp-session-id"] = this.#sessionId;
    if (this.#protocolVersion !== undefined)
      headers["mcp-protocol-version"] = this.#protocolVersion;
    return this.#http.fetch(this.#options.url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      ...(signal === undefined ? {} : { signal }),
      ...(this.#options.auth === undefined ? {} : { auth: this.#options.auth }),
    });
  }

  #throwUnlessOk(response: HttpResponse): void {
    if (!response.ok) {
      throw errorForStatus(response.status, this.#sessionId !== undefined);
    }
  }

  /** The server may hand out a session id in its answer to `initialize`. */
  #rememberSession(response: HttpResponse, message: OutgoingMessage): void {
    if (!isRequest(message) || message.method !== "initialize") return;
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId === null) return;
    // The spec allows visible ASCII only; anything else could break our headers.
    if (!/^[\x21-\x7e]{1,256}$/.test(sessionId)) throw unexpectedResponse();
    this.#sessionId = sessionId;
  }
}

function isRequest(message: OutgoingMessage): message is JsonRpcRequest {
  return "method" in message && "id" in message;
}

/** The content type without parameters such as `charset`. */
function mediaType(response: HttpResponse): string {
  return (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** The JSON-RPC messages in an event stream. MCP sends no other kind of event. */
async function* messagesIn(events: EventStream): AsyncGenerator<unknown> {
  try {
    for await (const event of events) {
      // An event with empty data only sets the id to resume from.
      if (event.type === "message" && event.data !== "") yield parseJson(event.data);
    }
  } catch (error) {
    throw error instanceof EventStreamError ? unexpectedResponse() : error;
  }
}

/** True when `value` is the result or error for request `id`; the session checks it fully. */
function isAnswerTo(value: unknown, id: number): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    value.id === id &&
    !("method" in value)
  );
}

/** Never lets a parse error out: it quotes part of the body (guide, section 7, rule 5). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw unexpectedResponse();
  }
}
