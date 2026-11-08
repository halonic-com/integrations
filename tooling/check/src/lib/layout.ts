/**
 * Where a package sits in the repo decides its layer and its npm name
 * (plan 3.4 and 4.1). Deriving both from the path means nobody has to
 * invent a name, and two packages can never end up with the same one.
 *
 * This repo has two layers: the integrations, and the repo's own tooling.
 * The main repo (halonic-com/halonic) has the full layer table.
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

/**
 * Works out the layer and the expected name from a package's folder,
 * relative to the repo root with forward slashes.
 *
 * @returns `undefined` when the folder is not a place where packages live
 *
 * @example
 * placeOf("integrations/gmail");
 * // { layer: "integrations", expectedName: "@halonicjs/integration-gmail" }
 */
export function placeOf(directory: string): PackagePlace | undefined {
  if (directory === ".") {
    return { layer: "tooling", expectedName: `${scope}/root` };
  }
  const parts = directory.split("/");
  const name = parts.at(-1) ?? "";
  const parent = parts.slice(0, -1).join("/");
  switch (parent) {
    case "integrations":
      return { layer: "integrations", expectedName: `${scope}/integration-${name}` };
    case "tooling":
      return { layer: "tooling", expectedName: `${scope}/tooling-${name}` };
    default:
      return undefined;
  }
}
