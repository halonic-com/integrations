import type {
  GoogleHost,
  HttpClient,
  HttpResponse,
} from "@halonicjs/integration-tool-google-shared";
import { type Replay, replay } from "@halonicjs/tooling-record/replay";
import { drive } from "../index.ts";
import type { IntegrationConnection } from "../kit.ts";

/**
 * A `wait` that resolves at once and records each pause, so a test can see
 * a retry's wait without waiting. The same shape as the Google library's
 * test `fakeWait`, which isn't exported.
 */
function recordingWait(): { wait: GoogleHost["wait"]; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    wait: async (ms, signal) => {
      signal?.throwIfAborted();
      waits.push(ms);
    },
  };
}

/**
 * Every Drive request asks the kit for the account's bearer token. The
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

/**
 * Connects Drive to a recording, through the shared replay in
 * `@halonicjs/tooling-record/replay`. The replay checks each call against
 * the next exchange and reads the file with the full recording schema.
 * Tests import the recording file as JSON and pass it in.
 */
export function connectToRecording(recording: unknown): {
  connection: IntegrationConnection;
  replay: Replay;
} {
  const recorded = replay(recording);
  const { wait } = recordingWait();
  return { connection: drive.connect({ http: requireBearer(recorded), wait }), replay: recorded };
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
): { connection: IntegrationConnection; urls: string[]; waits: number[] } {
  const urls: string[] = [];
  const response: HttpResponse = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
  };
  const http: HttpClient = {
    async fetch(url) {
      urls.push(url);
      return response;
    },
  };
  const { wait, waits } = recordingWait();
  return { connection: drive.connect({ http, wait }), urls, waits };
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
  const http: HttpClient = {
    async fetch(url, init) {
      requests.push({ url, body: init?.body });
      const answer = answers.shift();
      if (answer === undefined) {
        throw new Error(`The tool sent more requests than the test expected: ${url}`);
      }
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        headers: { get: () => null },
        text: async () => answer.body,
      };
    },
  };
  return { connection: drive.connect({ http, wait: recordingWait().wait }), requests };
}
