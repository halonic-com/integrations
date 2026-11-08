import { readFileSync } from "node:fs";
import type { GoogleHost, HttpClient } from "@halonicjs/integration-tool-google-shared";
import { type Replay, replay } from "@halonicjs/tooling-record/replay";
import { gmail } from "../index.ts";
import type { IntegrationConnection } from "../kit.ts";

/**
 * Connects Gmail to a recording, through the shared replay in
 * `@halonicjs/tooling-record/replay`. The replay checks each call against
 * the next exchange and reads the file with the full recording schema.
 */

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
 * The `recording.userContent` paths of integration.yaml. The replay scrubs
 * a sent body with them before it compares it with the recording, which
 * has the outgoing mail as `<scrubbed:content>`. Read from the sheet, so
 * the tests can't drift from it. Without a YAML parser: the section is a
 * plain list of paths, with comments between them.
 */
function sheetUserContent(): string[] {
  const sheet = readFileSync(new URL("../../integration.yaml", import.meta.url), "utf8");
  const section = /\nrecording:\n {2}userContent:\n((?: {4}.*\n)*)/.exec(`${sheet}\n`)?.[1] ?? "";
  const paths = [...section.matchAll(/^ {4}- (\S+)$/gm)].map((match) => match[1] ?? "");
  if (paths.length === 0) throw new Error("integration.yaml has no recording.userContent paths.");
  return paths;
}

/** Reads `recordings/<scenario>.json`. */
export function loadRecording(scenario: string): unknown {
  const file = new URL(`../../recordings/${scenario}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Every Gmail request asks the kit for the account's bearer token. The shared
 * replay checks a token only where a request asks for one, so a request that
 * forgets it fails here.
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

/** Connects the integration to a replay of one recording. */
export function connectToRecording(scenario: string): {
  connection: IntegrationConnection;
  replay: Replay;
  /** Each pause before a retry, in milliseconds. */
  waits: number[];
} {
  const recorded = replay(loadRecording(scenario), { policy: { userContent: sheetUserContent() } });
  const { wait, waits } = recordingWait();
  const connection = gmail.connect({ http: requireBearer(recorded), wait });
  return { connection, replay: recorded, waits };
}

/** Calls a tool and parses its JSON result. */
export async function callTool(
  connection: IntegrationConnection,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return JSON.parse(await connection.callTool(name, args));
}
