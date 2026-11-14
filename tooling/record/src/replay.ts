import type {
  IntegrationHttpClient,
  IntegrationRequestInit,
  SecretPlacement,
} from "@halonicjs/adapters/integration-kit";
import { type RecordingFile, recordingFileSchema } from "./format.ts";
import { replayContext } from "./replay/replay-context.ts";
import { RequestBodies } from "./replay/request-body.ts";
import { RequestUrls } from "./replay/request-url.ts";
import { ResponseBodies } from "./replay/response-body.ts";
import { definePolicy, type ScrubPolicyInput } from "./scrub/policy.ts";

export { fakeResponse, type TestHostOptions, testHost } from "./replay/test-host.ts";

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
 * in a devDependency.
 *
 * Why not `replayTransport` from `@halonicjs/testing/integration`: that one
 * stands below the kit and matches only `<scrubbed:…>` placeholders. This
 * repo's recordings also have numbered stand-ins for tokens a service
 * issued, user content scrubbed by the integration's policy, and optional
 * secrets left out, and this replay checks all three.
 */

/** What the integration sent. */
export interface SentRequest {
  url: string;
  init: IntegrationRequestInit;
  /** The request headers as a plain object with lowercase names, whichever form the integration gave them in. */
  headers: Record<string, string>;
  /** The body parsed back from JSON, or its text when it isn't JSON, such as a multipart upload. */
  body: unknown;
}

export interface Replay {
  readonly http: IntegrationHttpClient;
  readonly sent: readonly SentRequest[];
  assertAllUsed(): void;
}

type Exchange = RecordingFile["exchanges"][number];
type RecordedHeaders = Exchange["request"]["headers"];
type RecordedBody = Exchange["response"]["body"];

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
  const http: IntegrationHttpClient = {
    async fetch(url, init = {}) {
      const exchange = exchanges[sent.length];
      const body = textBody(init.body);
      const headers = plainHeaders(init.headers);
      sent.push({ url, init, headers, body: sentBody(body) });
      if (exchange === undefined) {
        throw new Error(`Unexpected call ${sent.length}: ${init.method ?? "GET"} ${url}`);
      }
      checkMatches(
        exchange,
        { url, method: init.method, headers, body, auth: init.auth },
        unset,
        check,
      );
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

/**
 * The request body as text. Integrations send text bodies; a stream or
 * bytes would have to be read first, which a replay doesn't do.
 */
function textBody(body: IntegrationRequestInit["body"]): string | undefined {
  if (body === undefined || body === null || typeof body === "string") {
    return body ?? undefined;
  }
  throw new Error("The replay reads text request bodies only.");
}

/** The request headers as a plain object with lowercase names. */
function plainHeaders(headers: IntegrationRequestInit["headers"]): Record<string, string> {
  return Object.fromEntries(new Headers(headers));
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

/** A sent request with its headers and body already read as text. */
interface SentParts {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly auth: IntegrationRequestInit["auth"];
}

function checkMatches(
  exchange: Exchange,
  sent: SentParts,
  unset: ReadonlySet<string>,
  check: RequestChecks,
): void {
  check.urls.check(exchange.request, sent.method ?? "GET", sent.url);
  const placed = [sent.auth ?? []].flat().filter((placement) => !unset.has(placement.secret));
  checkKey(exchange.request.headers, placed);
  checkHeaders(exchange.request.headers, sent.headers);
  const formKeyFields = new Set(
    placed.flatMap((placement) => (placement.as === "form" ? [placement.field] : [])),
  );
  check.bodies.check(exchange.request, sent.body, sent.headers, formKeyFields);
}

/**
 * The key is where the request asks the kit to put it, and nowhere else: a
 * recording with a key the request doesn't ask for fails as well.
 */
function checkKey(recorded: RecordedHeaders, auth: IntegrationRequestInit["auth"]): void {
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
function recordedKeyHeader(
  placement: SecretPlacement,
): { name: string; value: string } | undefined {
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

/**
 * The recorded response as a Web `Response`. The body is given as bytes, so
 * the `Response` adds no content type the recording doesn't have.
 */
function toResponse(recorded: Exchange["response"]): Response {
  const body =
    recorded.body.kind === "empty" ? null : new TextEncoder().encode(bodyText(recorded.body));
  return new Response(body, { status: recorded.status, headers: recorded.headers });
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
