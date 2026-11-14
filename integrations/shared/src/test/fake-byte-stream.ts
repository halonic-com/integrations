/** A real `ReadableStream` that also says what its reader did. */
export interface FakeByteStream extends ReadableStream<Uint8Array> {
  /** True once the reader cancelled the stream. */
  readonly cancelled: boolean;
  /** True once the reader has read from the stream and let go of it again. */
  readonly released: boolean;
}

/**
 * Builds a response body from pieces. Text pieces are UTF-8 encoded.
 *
 * @param failure fails the stream after the last piece, like a dropped connection
 */
export function fakeByteStream(
  pieces: readonly (string | Uint8Array)[],
  failure?: Error,
): FakeByteStream {
  const encoder = new TextEncoder();
  const queue = pieces.map((piece) => (typeof piece === "string" ? encoder.encode(piece) : piece));
  const state = { cancelled: false, started: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      // Called only when the reader asks for a piece, because the high water mark is 0.
      pull(controller) {
        state.started = true;
        const piece = queue.shift();
        if (piece !== undefined) {
          controller.enqueue(piece);
        } else if (failure !== undefined) {
          controller.error(failure);
        } else {
          controller.close();
        }
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return Object.defineProperties(stream, {
    cancelled: { get: () => state.cancelled },
    released: { get: () => state.started && !stream.locked },
  }) as FakeByteStream;
}
