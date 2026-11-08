import { type RecordingFile, recordingFileSchema } from "./format.ts";

/**
 * Replays a recording file as `host.http`, the way the conformance suite
 * will: each call must match the next exchange by method and URL, an
 * unexpected call fails, and `assertAllUsed` fails on an unused exchange.
 * Request bodies in a recording are scrubbed, so they aren't compared; tests
 * check what was sent through `sent`.
 *
 * For integration tests only: import it from `@halonicjs/tooling-record/replay`
 * in a devDependency. Replace with `@halonicjs/testing-integration` once it
 * is published.
 */

/*
 * The HTTP shapes below are the parts of the kit's `host.http` a replay
 * needs. Tooling can't import an integration, so they are written out here;
 * they match the local kit types the integrations use today, so a `Replay`'s
 * `http` can be passed where an integration expects its `IntegrationHttpClient`.
 */

/** Where the kit puts the integration's key in a request. */
export type KeyPlacement =
  | { secret: string; as: "bearer" }
  | { secret: string; as: "header"; header: string; prefix?: string }
  | { secret: string; as: "form"; field: string };

/** The parts of a request an integration sends through `host.http`. */
export interface ReplayRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Never read: integrations pass their own `AbortSignal` type, which the integration preset has no global for. */
  signal?: unknown;
  auth?: KeyPlacement | readonly KeyPlacement[];
}

/** The parts of the Web `Response` a replay gives back. */
export interface ReplayResponse {
  readonly ok: boolean;
  readonly status: number;
  /** The recorded response headers. Headers the recorder leaves out give `null`. */
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** `host.http`, as a replay provides it. */
export interface ReplayHttpClient {
  fetch(url: string, init?: ReplayRequestInit): Promise<ReplayResponse>;
}

/** What the integration sent, with the body parsed back from JSON. */
export interface SentRequest {
  url: string;
  init: ReplayRequestInit;
  body: unknown;
}

export interface Replay {
  readonly http: ReplayHttpClient;
  readonly sent: readonly SentRequest[];
  assertAllUsed(): void;
}

type Exchange = RecordingFile["exchanges"][number];

/** The placeholder the recorder writes where the kit put the integration's key. */
const scrubbedSecret = "<scrubbed:secret>";

/** Reads `recording` with the recording file schema, so a file the suite would refuse fails here too. */
export function replay(recording: unknown): Replay {
  const { exchanges } = recordingFileSchema.parse(recording);
  const sent: SentRequest[] = [];
  const http: ReplayHttpClient = {
    async fetch(url, init = {}) {
      const exchange = exchanges[sent.length];
      sent.push({ url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      if (exchange === undefined) {
        throw new Error(`Unexpected call ${sent.length}: ${init.method ?? "GET"} ${url}`);
      }
      checkMatches(exchange, url, init);
      return toResponse(exchange.response);
    },
  };
  return {
    http,
    sent,
    assertAllUsed() {
      if (sent.length !== exchanges.length) {
        throw new Error(`Used ${sent.length} of ${exchanges.length} recorded exchanges.`);
      }
    },
  };
}

function checkMatches(exchange: Exchange, url: string, init: ReplayRequestInit): void {
  const method = init.method ?? "GET";
  if (exchange.request.method !== method || exchange.request.url !== url) {
    throw new Error(
      `Expected ${exchange.request.method} ${exchange.request.url}, got ${method} ${url}`,
    );
  }
  // The recorded key header must be where this request asks the kit to put the key.
  for (const placement of [init.auth ?? []].flat()) {
    const expected = recordedKeyHeader(placement);
    if (expected !== undefined && exchange.request.headers[expected.name] !== expected.value) {
      throw new Error(`The recording has no key in the ${expected.name} header.`);
    }
  }
}

/** The header the recorder saves for a key the kit put in a header. A form field isn't checked. */
function recordedKeyHeader(placement: KeyPlacement): { name: string; value: string } | undefined {
  switch (placement.as) {
    case "bearer":
      return { name: "authorization", value: `Bearer ${scrubbedSecret}` };
    case "header":
      return {
        name: placement.header.toLowerCase(),
        value: `${placement.prefix ?? ""}${scrubbedSecret}`,
      };
    case "form":
      return undefined;
  }
}

function toResponse(recorded: Exchange["response"]): ReplayResponse {
  const { body } = recorded;
  return {
    ok: recorded.status >= 200 && recorded.status < 300,
    status: recorded.status,
    // The recorder saves header names in lower case, as `Headers.get` matches them.
    headers: { get: (name) => recorded.headers[name.toLowerCase()] ?? null },
    text: async () => {
      switch (body.kind) {
        case "empty":
          return "";
        case "json":
          return JSON.stringify(body.value);
        case "text":
          return body.value;
        default:
          throw new Error(`The replay can't read a "${body.kind}" body as text yet.`);
      }
    },
    json: async () => {
      switch (body.kind) {
        case "json":
          return body.value;
        case "empty":
          throw new SyntaxError("Unexpected end of JSON input");
        default:
          throw new Error(`The replay can't read a "${body.kind}" body as JSON yet.`);
      }
    },
  };
}

/**
 * A response for error paths that recordings can't show, such as a body that
 * isn't JSON. It has no headers, and `text` gives what `json` gives, as JSON.
 */
export function fakeResponse(status: number, json: () => Promise<unknown>): ReplayHttpClient {
  const response: ReplayResponse = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json,
    text: async () => JSON.stringify(await json()),
  };
  return { fetch: async () => response };
}
