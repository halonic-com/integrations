import { type RecordingFile, recordingFileSchema } from "./format.ts";
import { replayContext } from "./replay/replay-context.ts";
import { RequestBodies } from "./replay/request-body.ts";
import { RequestUrls } from "./replay/request-url.ts";
import { ResponseBodies } from "./replay/response-body.ts";
import { definePolicy, type ScrubPolicyInput } from "./scrub/policy.ts";

/**
 * Replays a recording file as `host.http`, the way the conformance suite
 * will: each call must match the next exchange by method and URL, an
 * unexpected call fails, and `assertAllUsed` fails on an unused exchange.
 * The key, the headers the integration sets and the request body must match
 * the recording too (see `checkMatches`). The URL and the body are scrubbed
 * with the integration's policy before they are compared, and each recorded
 * response must already match the policy (see `ResponseBodies`). Tests can
 * also check what was sent through `sent`.
 *
 * For integration tests only: import it from `@halonicjs/tooling-record/replay`
 * in a devDependency. Replace with `@halonicjs/testing-integration` once it
 * is published.
 */

/*
 * The HTTP shapes below are the parts of the kit's `host.http` a replay
 * needs. Tooling can't import an integration, so they are written out here;
 * they match the local kit types the integrations use today, so a `Replay`'s
 * `http` can be passed where an integration expects its `IntegrationHttpClient`
 * or `HttpClient`.
 */

/** Where the kit puts the integration's key. */
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
  readonly headers: { get(name: string): string | null };
  /** The body as a stream that yields it in one piece; `null` when there is none. */
  readonly body: ReplayByteStream | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** The parts of a `ReadableStream<Uint8Array>` a replay gives back. */
export interface ReplayByteStream {
  getReader(): {
    read(): Promise<{ done: false; value: Uint8Array } | { done: true; value?: undefined }>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
  };
}

/** `host.http`, as a replay provides it. */
export interface ReplayHttpClient {
  fetch(url: string, init?: ReplayRequestInit): Promise<ReplayResponse>;
}

/** What the integration sent. */
export interface SentRequest {
  url: string;
  init: ReplayRequestInit;
  /** The body parsed back from JSON, or its text when it isn't JSON, such as a multipart upload. */
  body: unknown;
}

export interface Replay {
  readonly http: ReplayHttpClient;
  readonly sent: readonly SentRequest[];
  assertAllUsed(): void;
}

type Exchange = RecordingFile["exchanges"][number];
type RecordedHeaders = Exchange["request"]["headers"];
type RecordedBody = Exchange["response"]["body"];

/*
 * Integration tests typecheck this file with the integration preset, which
 * has no Web or Node globals. The runtimes the tests run on all have these
 * two, so only the parts used here are declared.
 */
declare const TextEncoder: new () => { encode(text: string): Uint8Array };
declare const URLSearchParams: new (pairs: [string, string][]) => { toString(): string };

/** The placeholder the recorder writes where the kit put the integration's key. */
const scrubbedSecret = "<scrubbed:secret>";

/** The numbered stand-in the recorder writes for a token the service issued, such as a session id. */
const standIn = /scrubbed-secret-\d+/;

export interface ReplayOptions {
  /**
   * Optional secrets the workspace hasn't set up. The kit leaves them out
   * of the request even where the integration names them, so the recording
   * must not have them either.
   */
  readonly unsetSecrets?: readonly string[];
  /**
   * The integration's recording policy, as in its `integration.yaml`. A
   * recorded URL and body are scrubbed, so the replay scrubs the sent ones
   * with the same rules before it compares them. Without the policy, a field
   * or query parameter the recorder replaced as the user's own content
   * doesn't match, and a response with user content fails.
   */
  readonly policy?: ScrubPolicyInput;
}

/** Reads `recording` with the recording file schema, so a file the suite would refuse fails here too. */
export function replay(recording: unknown, options: ReplayOptions = {}): Replay {
  const { exchanges } = recordingFileSchema.parse(recording);
  const unset = new Set(options.unsetSecrets ?? []);
  const context = replayContext(definePolicy(options.policy));
  const check: RequestChecks = {
    urls: new RequestUrls(context),
    bodies: new RequestBodies(context),
  };
  const responses = new ResponseBodies(context.policy);
  const sent: SentRequest[] = [];
  const http: ReplayHttpClient = {
    async fetch(url, init = {}) {
      const exchange = exchanges[sent.length];
      sent.push({ url, init, body: sentBody(init.body) });
      if (exchange === undefined) {
        throw new Error(`Unexpected call ${sent.length}: ${init.method ?? "GET"} ${url}`);
      }
      checkMatches(exchange, url, init, unset, check);
      responses.check(exchange.request, exchange.response.body);
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

/** A JSON body parsed, any other text as it is, so a body that isn't JSON doesn't end the call. */
function sentBody(body: string | undefined): unknown {
  if (body === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** The checks that scrub what was sent before they compare it, sharing one replay's stand-ins. */
interface RequestChecks {
  readonly urls: RequestUrls;
  readonly bodies: RequestBodies;
}

function checkMatches(
  exchange: Exchange,
  url: string,
  init: ReplayRequestInit,
  unset: ReadonlySet<string>,
  check: RequestChecks,
): void {
  check.urls.check(exchange.request, init.method ?? "GET", url);
  const placed = [init.auth ?? []].flat().filter((placement) => !unset.has(placement.secret));
  checkKey(exchange.request.headers, placed);
  checkHeaders(exchange.request.headers, init.headers ?? {});
  const formKeyFields = new Set(
    placed.flatMap((placement) => (placement.as === "form" ? [placement.field] : [])),
  );
  check.bodies.check(exchange.request, init.body, init.headers ?? {}, formKeyFields);
}

/**
 * The key is where the request asks the kit to put it, and nowhere else: a
 * recording with a key the request doesn't ask for fails as well.
 */
function checkKey(recorded: RecordedHeaders, auth: ReplayRequestInit["auth"]): void {
  const keyHeaders = new Set<string>();
  for (const placement of [auth ?? []].flat()) {
    const expected = recordedKeyHeader(placement);
    if (expected === undefined) {
      continue;
    }
    keyHeaders.add(expected.name);
    if (recorded[expected.name] !== expected.value) {
      throw new Error(`The recording has no key in the ${expected.name} header.`);
    }
  }
  for (const [name, value] of Object.entries(recorded)) {
    if (value.includes(scrubbedSecret) && !keyHeaders.has(name)) {
      throw new Error(
        `The recording has a key in the ${name} header; the request doesn't ask for one.`,
      );
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

/**
 * A header the integration sets has the recorded value, when the recording
 * has it: the recorder leaves out headers that change on every run. A header
 * the recording has with a stand-in, such as a session id, must be sent: the
 * integration got that value from an earlier response.
 */
function checkHeaders(recorded: RecordedHeaders, sent: Record<string, string>): void {
  const sentByName = new Map(
    Object.entries(sent).map(([name, value]) => [name.toLowerCase(), value]),
  );
  for (const [name, value] of sentByName) {
    const recordedValue = recorded[name];
    if (recordedValue !== undefined && recordedValue !== value) {
      throw new Error(`The ${name} header is "${value}"; the recording has "${recordedValue}".`);
    }
  }
  for (const [name, value] of Object.entries(recorded)) {
    if (standIn.test(value) && !sentByName.has(name)) {
      throw new Error(`The request has no ${name} header; the recording has one.`);
    }
  }
}

function toResponse(recorded: Exchange["response"]): ReplayResponse {
  const headers = new Map(Object.entries(recorded.headers));
  const text = bodyText(recorded.body);
  return {
    ok: recorded.status >= 200 && recorded.status < 300,
    status: recorded.status,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    body: recorded.body.kind === "empty" ? null : byteStream(text),
    text: async () => text,
    // Parsed from the text, like a real `Response`, so an empty or event-stream body fails the same way.
    json: async () => JSON.parse(text),
  };
}

/** The body as the service sent it. */
function bodyText(body: RecordedBody): string {
  switch (body.kind) {
    case "empty":
      return "";
    case "json":
      return JSON.stringify(body.value);
    case "form":
      return new URLSearchParams(body.value).toString();
    case "text":
      return body.value;
    case "sse":
      return body.value.map(eventText).join("");
  }
}

/** One event in the event-stream format. The recorder parsed `data` only when it was a JSON object or list. */
function eventText({ event, data }: { event: string; data: unknown }): string {
  const dataText = typeof data === "string" ? data : JSON.stringify(data);
  const dataLines = dataText.split("\n").map((line) => `data: ${line}\n`);
  return `event: ${event}\n${dataLines.join("")}\n`;
}

/** A byte stream that yields `text` in one piece. */
function byteStream(text: string): ReplayByteStream {
  return {
    getReader() {
      let done = false;
      return {
        async read() {
          if (done) {
            return { done: true };
          }
          done = true;
          return { done: false, value: new TextEncoder().encode(text) };
        },
        async cancel() {},
        releaseLock() {},
      };
    },
  };
}

/**
 * A response for error paths that recordings can't show, such as a body that
 * isn't JSON. It has no headers or body stream, and `text` gives what `json`
 * gives, as JSON.
 */
export function fakeResponse(status: number, json: () => Promise<unknown>): ReplayHttpClient {
  return {
    fetch: async () => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      body: null,
      text: async () => JSON.stringify(await json()),
      json,
    }),
  };
}
