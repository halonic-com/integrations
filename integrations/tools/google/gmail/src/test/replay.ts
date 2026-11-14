import { readFileSync } from "node:fs";
import type { IntegrationConnection } from "@halonicjs/adapters/integration-kit";
import type { HttpClient } from "@halonicjs/integration-tool-google-shared";
import { fakeWait } from "@halonicjs/testing/integration";
import { type Replay, replay } from "@halonicjs/tooling-record/replay";
import { readSheetPolicy } from "@halonicjs/tooling-record/sheet-policy";
import { gmail } from "../index.ts";
import { hostFor } from "./host.ts";

/**
 * Connects Gmail to a recording, through the shared replay in
 * `@halonicjs/tooling-record/replay`. The replay checks each call against
 * the next exchange and reads the file with the full recording schema.
 */

/**
 * The `recording` section of integration.yaml. The replay scrubs what is
 * sent with it before it compares it with the recording, which has
 * the outgoing mail as `<scrubbed:content>`. Read from the sheet, so the tests
 * can't drift from it.
 */
const policy = readSheetPolicy(new URL("../../integration.yaml", import.meta.url));

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
  waits: readonly number[];
} {
  const recorded = replay(loadRecording(scenario), { policy });
  const { wait, waits } = fakeWait();
  const connection = gmail.connect(hostFor({ http: requireBearer(recorded), wait }));
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
