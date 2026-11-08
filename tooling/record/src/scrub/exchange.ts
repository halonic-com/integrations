/**
 * The shapes of one HTTP exchange, before and after scrubbing.
 *
 * Kept small and local on purpose: the kit's `HttpClient` interface (HAL-135)
 * isn't settled yet. When it is, `CapturedExchange` should become whatever the
 * kit's recording client hands us, and nothing else in this folder changes.
 */

/** One header as it went over the wire. Kept as pairs so repeated headers survive. */
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

/** What a recording file holds: the scrubbed exchange, with each body parsed. */
export interface RecordedExchange {
  readonly request: RecordedRequest;
  readonly response: RecordedResponse;
}

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: HeaderEntry[];
  readonly body: RecordedBody;
}

export interface RecordedResponse {
  readonly status: number;
  readonly headers: HeaderEntry[];
  readonly body: RecordedBody;
}

/**
 * A body after parsing. Bodies are saved parsed, not as raw text, so a
 * reviewer can read a recording in a pull request and every rule can see the
 * structure (field names, nesting) instead of guessing at a string.
 */
export type RecordedBody =
  | { readonly type: "empty" }
  | { readonly type: "json"; readonly value: JsonValue }
  | { readonly type: "form"; readonly fields: [name: string, value: string][] }
  | { readonly type: "text"; readonly contentType: string; readonly text: string };
