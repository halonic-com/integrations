import type {
  IntegrationConnection,
  IntegrationHttpClient,
  IntegrationRequestInit,
} from "@halonicjs/adapters/integration-kit";
import { readRecording } from "@halonicjs/tooling-record/recordings";
import { type Replay, replay, testHost } from "@halonicjs/tooling-record/replay";
import { readSheetPolicy } from "@halonicjs/tooling-record/sheet-policy";
import { paperclipIssues } from "../index.ts";

/**
 * Connects the integration to a recording, through the shared replay in
 * `@halonicjs/tooling-record/replay`, as Calendar's and Gmail's helpers do.
 * The recordings are invented traffic (README, "Recordings").
 */

/** The settings the recordings were made with: an invented server and company. */
export const settings = {
  url: "https://tasks.example.com",
  "company-id": "c0ffee00-0000-4000-8000-000000000001",
} as const;

/** The sheet's `recording` section, so the replay scrubs what is sent the way the recorder did. */
const policy = readSheetPolicy(new URL("../../integration.yaml", import.meta.url));

const recordings = new URL("../../recordings/", import.meta.url);

/**
 * Every request must ask the kit for `paperclip-key` as a bearer token. The
 * shared replay checks a key only where a request asks for one, so a
 * request that forgets it, or names another key, fails here.
 */
function requirePaperclipKey(recorded: Replay): IntegrationHttpClient {
  return {
    async fetch(url, init) {
      if (!asksForPaperclipKey(init)) {
        throw new Error(`The request to ${url} doesn't ask the kit for paperclip-key as bearer.`);
      }
      return recorded.http.fetch(url, init);
    },
  };
}

export function asksForPaperclipKey(init: IntegrationRequestInit | undefined): boolean {
  const auth = init?.auth;
  return (
    auth !== undefined &&
    "secret" in auth &&
    auth.secret === "paperclip-key" &&
    auth.as === "bearer"
  );
}

/** Connects the integration to a replay of `recordings/<scenario>.json`. */
export function connectToRecording(scenario: string): {
  connection: IntegrationConnection;
  replay: Replay;
} {
  const recorded = replay(readRecording(recordings, scenario), { policy });
  const connection = paperclipIssues.connect(testHost(requirePaperclipKey(recorded), { settings }));
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

/** What the integration sent to a fake Paperclip. */
export interface SentRequest {
  url: string;
  init: IntegrationRequestInit | undefined;
}

/**
 * Connects the integration to a fake Paperclip that answers every request
 * with one status and body text, for paths a recording can't show: a body
 * that isn't JSON, each error status, settings that are wrong. `requests`
 * collects what was sent.
 */
export function connectToFakePaperclip(
  status: number,
  body: string,
  hostSettings: Readonly<Record<string, unknown>> = settings,
): { connection: IntegrationConnection; requests: SentRequest[] } {
  const requests: SentRequest[] = [];
  const http: IntegrationHttpClient = {
    async fetch(url, init) {
      requests.push({ url, init });
      // A response can be read once, so each request gets its own.
      return new Response(body, { status });
    },
  };
  const connection = paperclipIssues.connect(testHost(http, { settings: hostSettings }));
  return { connection, requests };
}

/** A Paperclip error body that repeats what was sent, as a server's text can. */
export function paperclipError(): string {
  return JSON.stringify({ error: "Not found: Invented secret plan" });
}
