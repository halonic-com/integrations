import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readSheetFields } from "@halonicjs/tooling-check/sheet-yaml";

/**
 * The folder of the integration the user named: by its sheet `id`, such as
 * `model-anthropic`, or by its path from the repo root, such as
 * `integrations/models/anthropic`. A bare folder name isn't enough, because
 * integrations are grouped (`tools/mcp/http`, `knowledge/mcp`).
 *
 * @returns the absolute folder, or undefined when nothing matches
 */
export function findIntegration(root: string, given: string): string | undefined {
  if (given.includes("/")) {
    const folder = resolve(root, given);
    return existsSync(join(folder, "integration.yaml")) ? folder : undefined;
  }
  const sheets = globSync("integrations/**/integration.yaml", {
    cwd: root,
    exclude: (name) => name === "node_modules",
  });
  const match = sheets.find((sheet) => sheetId(join(root, sheet)) === given);
  return match === undefined ? undefined : dirname(join(root, match));
}

/** Only the `id` is read, so another integration's sheet can't stop the search. */
function sheetId(file: string): string | undefined {
  try {
    const id = readSheetFields(readFileSync(file, "utf8"), ["id"]).get("id")?.value;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}
