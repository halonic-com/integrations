import { readFileSync } from "node:fs";
import type { IntegrationConnection } from "@halonicjs/adapters/integration-kit";
import type { HttpClient, HttpResponse } from "@halonicjs/integration-tool-google-shared";
import { fakeWait } from "@halonicjs/testing/integration";
import { type Replay, replay } from "@halonicjs/tooling-record/replay";
import { readSheetPolicy } from "@halonicjs/tooling-record/sheet-policy";
import { calendar } from "../index.ts";
import { hostFor } from "./host.ts";

/**
 * Connects Calendar to a recording, through the shared replay in
 * `@halonicjs/tooling-record/replay`. The replay checks each call against
 * the next exchange, request body included, and reads the file with the
 * full recording schema. Gmail's and Drive's helpers work the same way.
 */

/**
 * The `recording` section of integration.yaml. The replay scrubs what is
 * sent with it before it compares it with the recording, which has
 * an event's title as `<scrubbed:content>`. Read from the sheet, so the tests
 * can't drift from it.
 */
const policy = readSheetPolicy(new URL("../../integration.yaml", import.meta.url));

/** Reads `recordings/<scenario>.json`. */
function loadRecording(scenario: string): unknown {
  const file = new URL(`../../recordings/${scenario}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Every Calendar request asks the kit for the account's bearer token. The
 * shared replay checks a token only where a request asks for one, so a
 * request that forgets it fails here.
 */
function requireBearer(recorded: Replay): HttpClient {
  return {
    async fetch(url, init) {
      if (init?.auth?.as !== "bearer") {
        throw new Error(
          `The request to ${url} doesn't ask the kit for the account's bearer token.`,
        );
      }
      return recorded.http.fetch(url, init);
    },
  };
}

/** Connects the integration to a replay of `recordings/<scenario>.json`. */
export function connectToRecording(scenario: string): {
  connection: IntegrationConnection;
  replay: Replay;
} {
  const recorded = replay(loadRecording(scenario), { policy });
  const { wait } = fakeWait();
  const connection = calendar.connect(hostFor({ http: requireBearer(recorded), wait }));
  return { connection, replay: recorded };
}

/** Calls a tool and parses its JSON result. */
export async function callTool(
  connection: IntegrationConnection,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return JSON.parse(await connection.callTool(name, args));
}

/**
 * Connects the integration to a fake Calendar that answers every request
 * with one status and body text, for paths a recording can't show: a body
 * that isn't JSON, each error status. `requests` collects what was sent,
 * and `waits` the pauses before retries.
 */
export function connectToFakeCalendar(
  status: number,
  body: string,
): {
  connection: IntegrationConnection;
  requests: { url: string; method: string | undefined; body: string | undefined }[];
  waits: readonly number[];
} {
  const requests: { url: string; method: string | undefined; body: string | undefined }[] = [];
  const response: HttpResponse = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
  };
  const http: HttpClient = {
    async fetch(url, init) {
      requests.push({ url, method: init?.method, body: init?.body });
      return response;
    },
  };
  const { wait, waits } = fakeWait();
  return { connection: calendar.connect(hostFor({ http, wait })), requests, waits };
}

/** A Google error body with a reason and a sentence that repeats the request, as Google's can. */
export function googleError(status: number, reason: string): string {
  const message = "Not Found: Dentist with Alex Example";
  return JSON.stringify({
    error: { code: status, errors: [{ domain: "global", reason, message }], message },
  });
}
