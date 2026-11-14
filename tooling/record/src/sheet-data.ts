import { readFileSync } from "node:fs";
import { parse } from "yaml";

/**
 * The permission sheet at `sheetUrl` as plain data, the way the conformance
 * suite wants it (`sheet` in `describeIntegrationConformance`). The suite
 * checks the sheet itself, so this reads it and checks nothing.
 *
 * Import it from `@halonicjs/tooling-record/sheet-data` in a test file. It
 * reads a file, so it is for tests in Node only, never for an integration.
 *
 * @example
 * const sheet = readSheetData(new URL("../../integration.yaml", import.meta.url));
 */
export function readSheetData(sheetUrl: URL): unknown {
  return parse(readFileSync(sheetUrl, "utf8"));
}
