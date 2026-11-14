import type {
  IntegrationConnection,
  IntegrationHttpClient,
} from "@halonicjs/adapters/integration-kit";
import { fakeWait } from "@halonicjs/testing/integration";
import { type Replay, replay, testHost } from "@halonicjs/tooling-record/replay";
import { readSheetPolicy } from "@halonicjs/tooling-record/sheet-policy";
import { drive } from "../index.ts";

/**
 * The `recording` section of integration.yaml. The replay scrubs what is
 * sent with it, the way the recorder did, before it compares it with the
 * recording.
 */
const policy = readSheetPolicy(new URL("../../integration.yaml", import.meta.url));

/**
 * Every Drive request asks the kit for the account's bearer token. The
 * shared replay checks a token only where a request asks for one, so a
 * request that forgets it fails here.
 */
function requireBearer(recorded: Replay): IntegrationHttpClient {
  return {
    async fetch(url, init) {
      // `auth` may also be a list of placements; Google sends exactly one.
      const auth = init?.auth;
      if (auth === undefined || !("as" in auth) || auth.as !== "bearer") {
        throw new Error(
          `The request to ${url} doesn't ask the kit for the account's bearer token.`,
        );
      }
      return recorded.http.fetch(url, init);
    },
  };
}

/**
 * Connects Drive to a recording, through the shared replay in
 * `@halonicjs/tooling-record/replay`. The replay checks each call against
 * the next exchange, request body included, and reads the file with the
 * full recording schema.
 * Tests import the recording file as JSON and pass it in.
 */
export function connectToRecording(recording: unknown): {
  connection: IntegrationConnection;
  replay: Replay;
} {
  const recorded = replay(recording, { policy });
  const { wait } = fakeWait();
  return {
    connection: drive.connect(testHost(requireBearer(recorded), { wait })),
    replay: recorded,
  };
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
 * Connects the integration to a fake Drive that answers every request with
 * one status and body text, for paths a recording can't show: a body that
 * isn't JSON, each error status. `urls` collects what was asked for, and
 * `waits` the pauses before retries.
 */
export function connectToFakeDrive(
  status: number,
  body: string,
): { connection: IntegrationConnection; urls: string[]; waits: readonly number[] } {
  const urls: string[] = [];
  const http: IntegrationHttpClient = {
    async fetch(url) {
      urls.push(url);
      // A response can be read once, so each request gets its own.
      return new Response(body, { status });
    },
  };
  const { wait, waits } = fakeWait();
  return { connection: drive.connect(testHost(http, { wait })), urls, waits };
}

/** One answer of {@link connectToFakeAnswers}. */
export interface FakeAnswer {
  status: number;
  body: string;
}

/**
 * Connects the integration to a fake Drive that gives `answers` in turn,
 * for a tool that sends more than one request, such as a read that works
 * and a change that fails. `requests` keeps each URL and the body sent.
 */
export function connectToFakeAnswers(...answers: FakeAnswer[]): {
  connection: IntegrationConnection;
  requests: { url: string; body: string | undefined }[];
} {
  const requests: { url: string; body: string | undefined }[] = [];
  const http: IntegrationHttpClient = {
    async fetch(url, init) {
      requests.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      const answer = answers.shift();
      if (answer === undefined) {
        throw new Error(`The tool sent more requests than the test expected: ${url}`);
      }
      return new Response(answer.body, { status: answer.status });
    },
  };
  return { connection: drive.connect(testHost(http, { wait: fakeWait().wait })), requests };
}
