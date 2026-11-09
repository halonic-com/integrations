import { readFileSync } from "node:fs";
import { readRecordingSheet } from "./command/sheet.ts";
import type { ScrubPolicy } from "./scrub/policy.ts";

/**
 * The recording policy of the permission sheet at `sheetUrl`, read the way
 * `pnpm record` reads it. For an integration's replay tests: passing the
 * sheet's own policy to `replay`, instead of a copy of some of its paths,
 * means a path taken out of the sheet fails a test.
 *
 * Import it from `@halonicjs/tooling-record/sheet-policy` in a test file. It
 * reads a file, so it is for tests in Node only, never for an integration.
 *
 * @example
 * const policy = readSheetPolicy(new URL("../integration.yaml", import.meta.url));
 */
export function readSheetPolicy(sheetUrl: URL): ScrubPolicy {
  return readRecordingSheet(readFileSync(sheetUrl, "utf8")).policy;
}
