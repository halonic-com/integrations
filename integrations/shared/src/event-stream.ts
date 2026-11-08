import { EventStreamError } from "./event-stream-error.ts";
import type { ByteStream } from "./http-client.ts";
import { LineSplitter } from "./line-splitter.ts";
import { decodeUtf8 } from "./utf8.ts";

/** One event from a `text/event-stream` answer. */
export interface ServerSentEvent {
  /** The `event:` field, or `"message"` when the event has none. */
  readonly type: string;
  /** The `data:` lines, joined with a line feed. */
  readonly data: string;
  /** The last `id:` the stream sent up to and with this event, or `""` when none. */
  readonly lastEventId: string;
}

/** Limits for one stream. */
export interface EventStreamLimits {
  /** The most bytes one event may take, all its lines together. Defaults to 1 MiB. */
  readonly maxEventBytes?: number;
}

/** No tool result or answer piece we pass on to a model comes close to this. */
const defaultMaxEventBytes = 1024 * 1024;

const byteOrderMark = "﻿";

/**
 * Reads server-sent events from a response body, piece by piece, as the
 * WHATWG rules describe
 * (https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation).
 * It never holds the whole stream: only the unfinished line and the event
 * being built.
 *
 * Read it with `for await`. Leaving the loop early cancels the stream.
 * Errors from the stream itself, such as a dropped connection or the kit's
 * timeout, pass through unchanged, and `lastEventId` stays at the last
 * complete event, so the caller can ask the service to resume.
 *
 * `retry:` fields are ignored: when to reconnect is the caller's choice.
 *
 * @example
 * const events = new EventStream(response.body);
 * for await (const event of events) {
 *   if (event.type === "message") handle(event.data);
 * }
 */
export class EventStream implements AsyncIterable<ServerSentEvent> {
  readonly #body: ByteStream;
  readonly #maxEventBytes: number;
  #lastEventId = "";
  #iterated = false;

  // The newest `id:` read. It becomes `lastEventId` only when its event is
  // complete, and it is not reset between events, as the rules say.
  #idBuffer = "";

  // The event being built, reset after each blank line.
  #type = "";
  #dataLines: string[] = [];
  #eventBytes = 0;

  constructor(body: ByteStream, limits: EventStreamLimits = {}) {
    this.#body = body;
    this.#maxEventBytes = limits.maxEventBytes ?? defaultMaxEventBytes;
  }

  /**
   * The id of the last complete event, also one without data. An event cut
   * off by a drop doesn't count, so a resume asks for it again. Send it as
   * `Last-Event-ID` to resume after a drop.
   */
  get lastEventId(): string {
    return this.#lastEventId;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<ServerSentEvent> {
    if (this.#iterated) {
      throw new Error("An event stream can be read only once.");
    }
    this.#iterated = true;
    const reader = this.#body.getReader();
    const lines = new LineSplitter(this.#maxEventBytes);
    let isFirstLine = true;
    let finished = false;
    try {
      while (true) {
        const piece = await reader.read();
        if (piece.done) {
          // An event without its closing blank line is dropped, as the rules say.
          finished = true;
          return;
        }
        for (const bytes of lines.split(piece.value)) {
          let line = this.#decode(bytes);
          if (isFirstLine) {
            line = line.startsWith(byteOrderMark) ? line.slice(1) : line;
            isFirstLine = false;
          }
          const event = this.#readLine(line, bytes.length);
          if (event !== undefined) {
            yield event;
          }
        }
      }
    } finally {
      if (finished) {
        reader.releaseLock();
      } else {
        // The caller stopped early or something failed: close the connection.
        // A failure to cancel says nothing new, so it doesn't hide the first error.
        await reader.cancel().catch(() => undefined);
      }
    }
  }

  #decode(bytes: Uint8Array): string {
    const line = decodeUtf8(bytes);
    if (line === undefined) {
      throw new EventStreamError("bad-encoding", "The event stream isn't valid UTF-8.");
    }
    return line;
  }

  /** Applies one line; returns the event a blank line completes. */
  #readLine(line: string, byteLength: number): ServerSentEvent | undefined {
    if (line === "") {
      return this.#dispatch();
    }
    this.#eventBytes += byteLength;
    if (this.#eventBytes > this.#maxEventBytes) {
      throw new EventStreamError("too-large", "An event in the event stream is too large.");
    }
    if (line.startsWith(":")) {
      return undefined; // a comment, often sent to keep the connection open
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    this.#applyField(field, value);
    return undefined;
  }

  #applyField(field: string, value: string): void {
    switch (field) {
      case "event":
        this.#type = value;
        break;
      case "data":
        this.#dataLines.push(value);
        break;
      case "id":
        // The rules ignore an id with a NUL in it.
        if (!value.includes("\0")) {
          this.#idBuffer = value;
        }
        break;
      default:
        // `retry` and unknown fields are ignored.
        break;
    }
  }

  #dispatch(): ServerSentEvent | undefined {
    this.#lastEventId = this.#idBuffer;
    const hasData = this.#dataLines.length > 0;
    const event: ServerSentEvent = {
      type: this.#type === "" ? "message" : this.#type,
      data: this.#dataLines.join("\n"),
      lastEventId: this.#lastEventId,
    };
    this.#type = "";
    this.#dataLines = [];
    this.#eventBytes = 0;
    // An event without any `data:` line is not dispatched, but its `id:` still counts.
    return hasData ? event : undefined;
  }
}
