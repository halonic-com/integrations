import { readFileSync } from "node:fs";

/**
 * The recording `<scenario>.json` in `folder`, parsed. The replay and the
 * conformance suite both check the recording's format themselves, so this
 * reads it and checks nothing.
 *
 * `folder` is the integration's `recordings` folder as a directory URL, so it
 * ends in a slash.
 *
 * Import it from `@halonicjs/tooling-record/recordings` in a test file. It
 * reads a file, so it is for tests in Node only, never for an integration.
 *
 * @example
 * const recordingsFolder = new URL("../recordings/", import.meta.url);
 * const sendDraft = readRecording(recordingsFolder, "send-draft");
 */
export function readRecording(folder: URL, scenario: string): unknown {
  return JSON.parse(readFileSync(new URL(`${scenario}.json`, folder), "utf8"));
}
