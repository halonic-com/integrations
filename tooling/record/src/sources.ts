import { readdirSync, readFileSync } from "node:fs";

/**
 * The source files under `folder`, the way the conformance suite wants them
 * (`sources` in `describeIntegrationConformance`): a map from the path the
 * suite reports to the file's text. Tests and files under a `test` folder are
 * left out, because the suite scans what ships.
 *
 * `folder` is a directory URL and ends in a slash. `prefix` is the path the
 * suite reports for it, such as `"gmail/src"`. Combine several folders by
 * spreading the results into one object.
 *
 * Import it from `@halonicjs/tooling-record/sources` in a test file. It reads
 * files, so it is for tests in Node only, never for an integration.
 *
 * @example
 * const sources = {
 *   ...readSources(new URL("../../../mcp-server/src/", import.meta.url), "mcp-server/src"),
 *   ...readSources(new URL("./", import.meta.url), "knowledge/mcp-online/src"),
 * };
 */
export function readSources(folder: URL, prefix: string): Record<string, string> {
  const files = readdirSync(folder, { recursive: true, encoding: "utf8" });
  return Object.fromEntries(
    files
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) => !file.split("/").includes("test"))
      .map((file) => [`${prefix}/${file}`, readFileSync(new URL(file, folder), "utf8")]),
  );
}
