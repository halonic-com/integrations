import { readFileSync } from "node:fs";
import type {
  HttpClient,
  HttpRequestInit,
  HttpResponse,
} from "@halonicjs/integration-tool-google-shared";
import { z } from "zod";
import { gmail } from "../index.ts";
import type { IntegrationConnection } from "../kit.ts";

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
        headers: z.record(z.string(), z.string()),
        body: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("empty") }),
          z.object({ kind: z.literal("json"), value: z.json() }),
        ]),
      }),
    }),
  ),
});
type Exchange = z.infer<typeof recordingSchema>["exchanges"][number];

/** What the integration sent, with a JSON body parsed back. */
export interface SentRequest {
  url: string;
  init: HttpRequestInit;
  body: unknown;
}

export interface Replay {
  readonly http: HttpClient;
  readonly sent: readonly SentRequest[];
  assertAllUsed(): void;
}

/** What the recorder writes where the kit put the account's access token. */
const scrubbedBearer = "Bearer <scrubbed:secret>";

export function replay(recording: unknown): Replay {
  const { exchanges } = recordingSchema.parse(recording);
  const sent: SentRequest[] = [];
  const http: HttpClient = {
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

function checkMatches(exchange: Exchange, url: string, init: HttpRequestInit): void {
  const method = init.method ?? "GET";
  if (exchange.request.method !== method || exchange.request.url !== url) {
    throw new Error(
      `Expected ${exchange.request.method} ${exchange.request.url}, got ${method} ${url}`,
    );
  }
  // Every Gmail request names the account's secret; the recording shows where the kit put it.
  if (init.auth?.as !== "bearer" || exchange.request.headers["authorization"] !== scrubbedBearer) {
    throw new Error("The request doesn't ask the kit for the account's bearer token.");
  }
}

function toResponse(recorded: Exchange["response"]): HttpResponse {
  const headers = new Map(Object.entries(recorded.headers));
  return {
    ok: recorded.status >= 200 && recorded.status < 300,
    status: recorded.status,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    text: async () => (recorded.body.kind === "empty" ? "" : JSON.stringify(recorded.body.value)),
  };
}

/** Reads `recordings/<scenario>.json`. */
export function loadRecording(scenario: string): unknown {
  const file = new URL(`../../recordings/${scenario}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Connects the integration to a replay of one recording. */
export function connectToRecording(scenario: string): {
  connection: IntegrationConnection;
  replay: Replay;
} {
  const recorded = replay(loadRecording(scenario));
  return { connection: gmail.connect({ http: recorded.http }), replay: recorded };
}

/** Calls a tool and parses its JSON result. */
export async function callTool(
  connection: IntegrationConnection,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return JSON.parse(await connection.callTool(name, args));
}
