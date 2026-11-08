import { readFileSync } from "node:fs";
import type { HttpClient } from "@halonicjs/integration-tool-google-shared";
import { type Replay, replay } from "@halonicjs/tooling-record/replay";
import { gmail } from "../index.ts";
import type { IntegrationConnection } from "../kit.ts";

/**
 * Connects Gmail to a recording, through the shared replay in
 * `@halonicjs/tooling-record/replay`. The replay checks each call against
 * the next exchange and reads the file with the full recording schema.
 */

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
} {
  const recorded = replay(loadRecording(scenario));
  return { connection: gmail.connect({ http: requireBearer(recorded) }), replay: recorded };
}

/** Calls a tool and parses its JSON result. */
export async function callTool(
  connection: IntegrationConnection,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return JSON.parse(await connection.callTool(name, args));
}
