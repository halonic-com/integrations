import type { CapturedExchange, CapturedRequest, HeaderEntry } from "../scrub/exchange.ts";

/**
 * The raw transport under the kit, the `HttpClient` port of
 * halonic-com/halonic (`packages/core/ports/src/http-client.ts`). Copied
 * here because `@halonicjs/adapters` publishes only what an integration
 * imports, and an integration never sees the transport.
 */
export interface HttpTransport {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/** A transport that keeps every exchange it carries, for one scenario. */
export interface RecordingTransport {
  /** Pass this to the kit as its `transport`. */
  readonly transport: HttpTransport;
  /**
   * The exchanges so far, in call order. Call it once the scenario has
   * finished: each response body is the part the kit had read by then.
   * Unscrubbed: give them only to `prepareRecording`.
   */
  exchanges(): readonly CapturedExchange[];
}

/** Statuses whose response can't have a body, so `new Response` refuses one. */
const nullBodyStatuses = new Set([101, 204, 205, 304]);

/** One call, from the moment it was made. `response` is set once the headers arrive. */
interface Slot {
  request?: CapturedRequest;
  response?: ResponseCapture;
}

/** A response whose body is captured while the kit reads it. */
interface ResponseCapture {
  readonly status: number;
  readonly headers: readonly HeaderEntry[];
  readonly bodyChunks: Uint8Array[];
}

/**
 * Wraps the real transport so `pnpm record` sees every request exactly as it
 * went over the wire. It sits under the kit, so the kit has already placed
 * the keys and checked the host; a redirect is one exchange per hop.
 *
 * It answers as soon as the real transport does, and keeps each piece of the
 * body as the kit reads it. So the kit's timeouts and size limit work the same
 * while recording (guide, section 9: behave the same in tests and in use), and
 * the recorded body is exactly what the kit read: a body it cancelled, such as
 * a redirect hop's or one over the size limit, is kept only as far as it got.
 *
 * @example
 * const recording = createRecordingTransport({ fetch });
 * const { host } = createIntegrationHost({ policy, transport: recording.transport, secrets, tokens });
 * // ... run the scenario ...
 * prepareRecording({ ..., exchanges: recording.exchanges() });
 */
export function createRecordingTransport(real: HttpTransport): RecordingTransport {
  const slots: Slot[] = [];
  return {
    transport: {
      async fetch(url, init) {
        // Taken before anything is awaited, so concurrent calls keep call order.
        const slot: Slot = {};
        slots.push(slot);
        slot.request = await captureRequest(url, init);
        const response = await real.fetch(url, init);
        const { capture, passOn } = captureResponse(response);
        slot.response = capture;
        return passOn;
      },
    },
    exchanges: () => slots.flatMap(toExchange),
  };
}

/** A call that failed, or hasn't been answered yet, has no exchange. */
function toExchange(slot: Slot): CapturedExchange[] {
  if (slot.request === undefined || slot.response === undefined) return [];
  // Not fatal: a body that isn't text is still captured, and the scrubber
  // refuses its content type unless the sheet allows it.
  const body = new TextDecoder().decode(joinChunks(slot.response.bodyChunks));
  return [
    {
      request: slot.request,
      response: {
        status: slot.response.status,
        headers: slot.response.headers,
        ...(body === "" ? {} : { body }),
      },
    },
  ];
}

async function captureRequest(url: string, init: RequestInit | undefined) {
  if (init?.body instanceof ReadableStream) {
    // Reading it here would leave nothing to send. The kit never sends one.
    throw new Error("pnpm record can't capture a request body sent as a stream");
  }
  // `Request` turns any body the kit sends (text, form, bytes) into text and
  // adds the content type it implies, as `fetch` would. Bytes that aren't
  // text are decoded lossily, like a response body.
  const request = new Request(url, init);
  const body = await request.text();
  return {
    method: request.method,
    url: request.url,
    headers: headerEntries(request.headers),
    ...(body === "" ? {} : { body }),
  };
}

/**
 * Builds the response the kit gets: the same status and headers, and a body
 * that hands each piece on as the kit reads it, keeping a copy. Nothing is
 * read ahead of the kit, so a cancel reaches the real body unchanged.
 */
function captureResponse(response: Response) {
  const capture: ResponseCapture = {
    status: response.status,
    headers: headerEntries(response.headers),
    bodyChunks: [],
  };
  const body =
    response.body === null || nullBodyStatuses.has(response.status)
      ? null
      : passThrough(response.body, capture.bodyChunks);
  const passOn = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // A new Response has no URL; keep the real one, as `fetch` would.
  Object.defineProperty(passOn, "url", { value: response.url });
  return { capture, passOn };
}

/** A stream that reads `source` only when it is read, and copies each piece into `chunks`. */
function passThrough(
  source: ReadableStream<Uint8Array>,
  chunks: Uint8Array[],
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        chunks.push(value);
        controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    // The default of 1 would pull the first piece before the kit asks for it.
    { highWaterMark: 0 },
  );
}

function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** Every header as a pair. `set-cookie` is kept one entry per cookie. */
function headerEntries(headers: Headers): HeaderEntry[] {
  const entries: HeaderEntry[] = [];
  for (const [name, value] of headers) {
    if (name === "set-cookie") continue;
    entries.push([name, value]);
  }
  for (const cookie of headers.getSetCookie()) {
    entries.push(["set-cookie", cookie]);
  }
  return entries;
}
