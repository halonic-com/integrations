import type { CapturedExchange, HeaderEntry } from "../scrub/exchange.ts";

/**
 * The raw transport under the kit, the `HttpClient` port of
 * halonic-com/halonic (`packages/core/ports/src/http-client.ts`). Copied
 * here until the kit is published; then import it from there.
 */
export interface HttpTransport {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/** A transport that keeps every exchange it carries, for one scenario. */
export interface RecordingTransport {
  /** Pass this to the kit as its `transport`. */
  readonly transport: HttpTransport;
  /** The exchanges so far, in call order. Unscrubbed: give them only to `prepareRecording`. */
  exchanges(): readonly CapturedExchange[];
}

/** Statuses whose response can't have a body, so `new Response` refuses one. */
const nullBodyStatuses = new Set([101, 204, 205, 304]);

/**
 * Wraps the real transport so `pnpm record` sees every request exactly as it
 * went over the wire. It sits under the kit, so the kit has already placed
 * the keys and checked the host; a redirect is one exchange per hop.
 *
 * Each response body is read in full before the integration gets it, so a
 * streamed answer arrives at once. That changes nothing an integration may
 * depend on (guide, section 9: behave the same in tests and in use).
 *
 * @example
 * const recording = createRecordingTransport({ fetch });
 * const { host } = createIntegrationHost({ policy, transport: recording.transport, secrets, tokens });
 * // ... run the scenario ...
 * prepareRecording({ ..., exchanges: recording.exchanges() });
 */
export function createRecordingTransport(real: HttpTransport): RecordingTransport {
  const exchanges: CapturedExchange[] = [];
  return {
    transport: {
      async fetch(url, init) {
        const request = await captureRequest(url, init);
        const response = await real.fetch(url, init);
        const { captured, replacement } = await captureResponse(response);
        exchanges.push({ request, response: captured });
        return replacement;
      },
    },
    exchanges: () => [...exchanges],
  };
}

async function captureRequest(url: string, init: RequestInit | undefined) {
  if (init?.body instanceof ReadableStream) {
    // Reading it here would leave nothing to send. The kit never sends one.
    throw new Error("pnpm record can't capture a request body sent as a stream");
  }
  // `Request` turns any body the kit sends (text, form, bytes) into text and
  // adds the content type it implies, as `fetch` would.
  const request = new Request(url, init);
  const body = await request.text();
  return {
    method: request.method,
    url: request.url,
    headers: headerEntries(request.headers),
    ...(body === "" ? {} : { body }),
  };
}

async function captureResponse(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Not fatal: a body that isn't text is still captured, and the scrubber
  // refuses its content type unless the sheet allows it.
  const body = new TextDecoder().decode(bytes);
  const captured = {
    status: response.status,
    headers: headerEntries(response.headers),
    ...(body === "" ? {} : { body }),
  };
  const replacement = new Response(nullBodyStatuses.has(response.status) ? null : bytes, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // A new Response has no URL; the kit logs the one the answer came from.
  Object.defineProperty(replacement, "url", { value: response.url });
  return { captured, replacement };
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
