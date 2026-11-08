/**
 * Why an event stream couldn't be read:
 *
 * - `too-large`: an event or a line grew past the limit;
 * - `bad-encoding`: the stream isn't valid UTF-8.
 *
 * Each integration maps this to its own `unexpected-response` (guide,
 * section 7). Errors from the stream itself, such as a dropped connection
 * or the kit's timeout, pass through unchanged.
 */
export type EventStreamErrorCode = "too-large" | "bad-encoding";

/** An event stream the service sent that we refuse to read further. */
export class EventStreamError extends Error {
  override readonly name = "EventStreamError";
  readonly code: EventStreamErrorCode;

  constructor(code: EventStreamErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
