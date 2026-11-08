import type { ByteStream } from "../http-client.ts";

/** A body that arrives in the given pieces, then ends or fails. */
export interface FakeByteStream extends ByteStream {
  /** True once the reader cancelled the stream. */
  readonly cancelled: boolean;
  /** True once the reader released the stream after its end. */
  readonly released: boolean;
}

/**
 * Builds a response body from pieces. Text pieces are UTF-8 encoded.
 *
 * @param failure thrown by the read after the last piece, like a dropped connection
 */
export function fakeByteStream(
  pieces: readonly (string | Uint8Array)[],
  failure?: Error,
): FakeByteStream {
  const encoder = new TextEncoder();
  const queue = pieces.map((piece) => (typeof piece === "string" ? encoder.encode(piece) : piece));
  const state = { cancelled: false, released: false };
  return {
    get cancelled() {
      return state.cancelled;
    },
    get released() {
      return state.released;
    },
    getReader() {
      return {
        async read() {
          const value = queue.shift();
          if (value !== undefined) {
            return { done: false, value };
          }
          if (failure !== undefined) {
            throw failure;
          }
          return { done: true };
        },
        async cancel() {
          state.cancelled = true;
        },
        releaseLock() {
          state.released = true;
        },
      };
    },
  };
}
