import { z } from "zod";
import type { HttpResponse, IntegrationHttpClient, IntegrationRequestInit } from "../kit.ts";

/**
 * Replays a `halonic.recording/1` file as `host.http`, the way the
 * conformance suite will: each call must match the next exchange by method
 * and URL, an unexpected call fails, and `assertAllUsed` fails on an unused
 * exchange. Request bodies in a recording are scrubbed, so they aren't
 * compared; tests check what was sent through `sent`.
 *
 * Replace with `@halonicjs/testing-integration` once it is published.
 */

/** The part of the recording format (`tooling/record/src/format.ts`) a replay reads. */
const recordingSchema = z.object({
  format: z.literal("halonic.recording/1"),
  exchanges: z.array(
    z.object({
      transport: z.literal("http"),
      request: z.object({
        method: z.string(),
        url: z.string(),
        headers: z.record(z.string(), z.string()),
      }),
      response: z.object({
        status: z.int(),
        body: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("empty") }),
          z.object({ kind: z.literal("json"), value: z.json() }),
        ]),
      }),
    }),
  ),
});
type Exchange = z.infer<typeof recordingSchema>["exchanges"][number];

/** What the integration sent, with the body parsed back from JSON. */
export interface SentRequest {
  url: string;
  init: IntegrationRequestInit;
  body: unknown;
}

export interface Replay {
  readonly http: IntegrationHttpClient;
  readonly sent: readonly SentRequest[];
  assertAllUsed(): void;
}

/** The placeholder the recorder writes where the kit put the integration's key. */
const scrubbedSecret = "<scrubbed:secret>";

export function replay(recording: unknown): Replay {
  const { exchanges } = recordingSchema.parse(recording);
  const sent: SentRequest[] = [];
  const http: IntegrationHttpClient = {
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

function checkMatches(exchange: Exchange, url: string, init: IntegrationRequestInit): void {
  const method = init.method ?? "GET";
  if (exchange.request.method !== method || exchange.request.url !== url) {
    throw new Error(
      `Expected ${exchange.request.method} ${exchange.request.url}, got ${method} ${url}`,
    );
  }
  // The recorded key header must be where this request asks the kit to put the key.
  for (const placement of [init.auth ?? []].flat()) {
    if (
      placement.as === "header" &&
      exchange.request.headers[placement.header] !== scrubbedSecret
    ) {
      throw new Error(`The recording has no key in the ${placement.header} header.`);
    }
  }
}

function toResponse(recorded: Exchange["response"]): HttpResponse {
  return {
    ok: recorded.status >= 200 && recorded.status < 300,
    status: recorded.status,
    json: async () => {
      if (recorded.body.kind === "empty") {
        throw new SyntaxError("Unexpected end of JSON input");
      }
      return recorded.body.value;
    },
  };
}

/** A response for error paths that recordings can't show, such as a body that isn't JSON. */
export function fakeResponse(status: number, json: () => Promise<unknown>): IntegrationHttpClient {
  return { fetch: async () => ({ ok: status >= 200 && status < 300, status, json }) };
}
