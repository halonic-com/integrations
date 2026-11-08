import { EventStreamError } from "./event-stream-error.ts";

const lineFeed = 0x0a;
const carriageReturn = 0x0d;

/**
 * Cuts a stream of bytes into lines, piece by piece. A line ends at CR LF,
 * LF or CR, as server-sent events allow
 * (https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream).
 *
 * It splits bytes, not text: CR and LF never occur inside a multi-byte
 * UTF-8 sequence, so each line can be decoded on its own and a character
 * cut between two pieces is never a problem.
 *
 * It keeps only the unfinished line, never more than `maxLineBytes`.
 */
export class LineSplitter {
  readonly #maxLineBytes: number;
  /** The start of a line that hasn't ended yet, from earlier pieces. */
  #unfinished: Uint8Array[] = [];
  #unfinishedBytes = 0;
  /** A CR ended the last line, so an LF right after it belongs to that line end. */
  #afterCarriageReturn = false;

  constructor(maxLineBytes: number) {
    this.#maxLineBytes = maxLineBytes;
  }

  /**
   * @returns every line that ends in this piece, without its line end
   * @throws {EventStreamError} `too-large` when a line grows past the limit
   */
  *split(piece: Uint8Array): Generator<Uint8Array> {
    let lineStart = 0;
    for (let index = 0; index < piece.length; index += 1) {
      const byte = piece[index];
      if (byte === lineFeed && this.#afterCarriageReturn) {
        // The second half of a CR LF that may have been cut between pieces.
        this.#afterCarriageReturn = false;
        lineStart = index + 1;
        continue;
      }
      this.#afterCarriageReturn = byte === carriageReturn;
      if (byte === lineFeed || byte === carriageReturn) {
        yield this.#finishLine(piece.subarray(lineStart, index));
        lineStart = index + 1;
      }
    }
    this.#keepUnfinished(piece.subarray(lineStart));
  }

  #finishLine(end: Uint8Array): Uint8Array {
    this.#checkSize(end.length);
    if (this.#unfinished.length === 0) {
      return end;
    }
    const line = new Uint8Array(this.#unfinishedBytes + end.length);
    let offset = 0;
    for (const part of [...this.#unfinished, end]) {
      line.set(part, offset);
      offset += part.length;
    }
    this.#unfinished = [];
    this.#unfinishedBytes = 0;
    return line;
  }

  #keepUnfinished(rest: Uint8Array): void {
    if (rest.length === 0) {
      return;
    }
    this.#checkSize(rest.length);
    // A copy, so the stream may reuse its buffer for the next piece.
    this.#unfinished.push(rest.slice());
    this.#unfinishedBytes += rest.length;
  }

  #checkSize(moreBytes: number): void {
    if (this.#unfinishedBytes + moreBytes > this.#maxLineBytes) {
      throw new EventStreamError("too-large", "A line in the event stream is too long.");
    }
  }
}
