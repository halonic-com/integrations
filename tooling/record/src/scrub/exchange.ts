/**
 * The shapes of one HTTP exchange, before and after scrubbing.
 *
 * Kept small and local on purpose: the kit's `HttpClient` interface (HAL-135)
 * isn't settled yet. When it is, `CapturedExchange` should become whatever the
 * kit's recording client hands us, and nothing else in this folder changes.
 *
 * The recorded shapes are the ones in a recording file; `src/format.ts` holds
 * the matching Zod schema the conformance suite reads.
 */

/** One header as it went over the wire. Kept as pairs so repeated headers survive capture. */
export type HeaderEntry = readonly [name: string, value: string];

/** A JSON value, as `JSON.parse` returns it. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** What the recorder captured, unscrubbed. Never written anywhere as-is. */
export interface CapturedExchange {
  readonly request: CapturedRequest;
  readonly response: CapturedResponse;
}

export interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: readonly HeaderEntry[];
  /** The body as text; absent when there was none. */
  readonly body?: string;
}

export interface CapturedResponse {
  readonly status: number;
  readonly headers: readonly HeaderEntry[];
  /** The body as text; absent when there was none. */
  readonly body?: string;
}

/**
 * What a recording file holds: one scrubbed exchange. Tagged by transport so
 * local MCP programs (`"stdio"`, ordered JSON-RPC messages) can be added later
 * without changing the format version.
 */
export interface RecordedExchange {
  readonly transport: "http";
  readonly request: RecordedRequest;
  readonly response: RecordedResponse;
}

/** Header names in lower case; headers that change on every run are left out. */
export type RecordedHeaders = Record<string, string>;

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: RecordedHeaders;
  readonly body: RecordedBody;
}

export interface RecordedResponse {
  readonly status: number;
  readonly headers: RecordedHeaders;
  readonly body: RecordedBody;
}

/** One event of a `text/event-stream` body. `data` is parsed when it is JSON. */
export interface StreamEvent {
  readonly event: string;
  readonly data: JsonValue;
}

/**
 * A body after parsing. Bodies are saved parsed, not as raw text, so a
 * reviewer can read a recording in a pull request and every rule can see the
 * structure (field names, nesting, stream events) instead of guessing at a
 * string.
 */
export type RecordedBody =
  | { readonly kind: "empty" }
  | { readonly kind: "json"; readonly value: JsonValue }
  | { readonly kind: "form"; readonly value: [name: string, value: string][] }
  | { readonly kind: "text"; readonly contentType: string; readonly value: string }
  | { readonly kind: "sse"; readonly value: StreamEvent[] };
