/**
 * Where a package sits in the repo decides its layer and its npm name
 * (plan 3.4 and 4.1). Deriving both from the path means nobody has to
 * invent a name, and two packages can never end up with the same one.
 *
 * This repo has two layers: the integrations, and the repo's own tooling.
 * The main repo (halonic-com/halonic) has the full layer table.
 *
 * Integrations are grouped by kind (docs/guides/integrations.md, section 2):
 *
 * | Folder                                    | Integration name               |
 * | ----------------------------------------- | ------------------------------ |
 * | `integrations/models/<provider>`          | `model-<provider>`             |
 * | `integrations/knowledge/<source>`         | `knowledge-<source>`           |
 * | `integrations/tools/<provider>/<service>` | `tool-<provider>-<service>`    |
 * | `integrations/<name>`                     | `<name>` (belongs to no group) |
 */

/** The layers of this repo. */
export type Layer = "integrations" | "tooling";

/** What the path of a package tells us about it. */
export interface PackagePlace {
  readonly layer: Layer;
  readonly expectedName: string;
}

/** The npm scope of every workspace package (plan 3.2). */
export const scope = "@halonicjs";

/** Folder names are short kebab-case words: `gmail`, `llm-openai`. */
export const folderNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A folder below `integrations/` that groups integrations of one kind. */
interface IntegrationGroup {
  /** The first word of the integration name: `tools` gives `tool-...`. */
  readonly prefix: string;
  /** How many folders an integration sits below the group folder. */
  readonly depth: number;
}

/**
 * The integration groups. A group folder is never an integration itself,
 * so no ungrouped integration may take one of these names.
 */
export const integrationGroups: ReadonlyMap<string, IntegrationGroup> = new Map([
  ["models", { prefix: "model", depth: 1 }],
  ["knowledge", { prefix: "knowledge", depth: 1 }],
  ["tools", { prefix: "tool", depth: 2 }],
]);

/**
 * Works out the layer and the expected name from a package's folder,
 * relative to the repo root with forward slashes.
 *
 * @returns `undefined` when the folder is not a place where packages live
 *
 * @example
 * placeOf("integrations/tools/google/gmail");
 * // { layer: "integrations", expectedName: "@halonicjs/integration-tool-google-gmail" }
 */
export function placeOf(directory: string): PackagePlace | undefined {
  if (directory === ".") {
    return { layer: "tooling", expectedName: `${scope}/root` };
  }
  const [top, ...rest] = directory.split("/");
  if (top === "tooling" && rest.length === 1) {
    return { layer: "tooling", expectedName: `${scope}/tooling-${rest[0]}` };
  }
  if (top === "integrations") {
    const name = integrationName(rest);
    return name === undefined
      ? undefined
      : { layer: "integrations", expectedName: `${scope}/integration-${name}` };
  }
  return undefined;
}

/**
 * The integration name for the folders below `integrations/`, or
 * `undefined` when they don't form a valid place for an integration.
 */
function integrationName(folders: readonly string[]): string | undefined {
  const [first, ...below] = folders;
  if (first === undefined) {
    return undefined;
  }
  const group = integrationGroups.get(first);
  if (group === undefined) {
    return below.length === 0 ? first : undefined;
  }
  return below.length === group.depth ? [group.prefix, ...below].join("-") : undefined;
}
