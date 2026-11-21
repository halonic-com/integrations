/**
 * Halonic's runner lets an integration import only its own files and `zod`
 * (`integration-runner.module-fence` in halonic-com/halonic). Built code
 * still names packages, such as `@halonicjs/adapters/integration-kit`, so
 * every such name is turned into a path to the copy inside the folder.
 */

import { FolderError } from "./folder-error.ts";

/**
 * An import that names a module, in single or double quotes: `from "x"`
 * (also `export … from "x"`), `import "x"` and `import("x")`. Group 1 is
 * what comes before the quote, group 2 the quote, group 3 the name.
 */
const importPattern = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])([^"'\n]+)\2/g;

/** The one package the runner resolves itself, from the folder's own `node_modules`. */
const runnerResolves = "zod";

/** Says which file inside the folder a package import becomes, as a path relative to the importing file. */
export type ResolveImport = (specifier: string) => string | undefined;

/** Thrown for an import the runner would refuse and that has no copy in the folder. */
export class ImportNotAllowed extends FolderError {
  override readonly name = "ImportNotAllowed";

  constructor(file: string, specifier: string) {
    super(
      `${file} imports "${specifier}", which Halonic's runner doesn't allow and which isn't copied into the folder.`,
    );
  }
}

/**
 * Turns every package import in `code` into a relative path. A relative
 * import and `zod` stay as they are.
 *
 * @param file - the file's name, only for the error
 * @throws {ImportNotAllowed} for an import `resolve` doesn't know
 *
 * @example
 * rewriteImports('import { runTool } from "@halonicjs/adapters/integration-kit";', "index.js", resolve);
 * // 'import { runTool } from "../vendor/adapters/dist/…/index.js";'
 */
export function rewriteImports(code: string, file: string, resolve: ResolveImport): string {
  return code.replace(importPattern, (whole, keyword: string, quote: string, specifier: string) => {
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === runnerResolves) {
      return whole;
    }
    const path = resolve(specifier);
    if (path === undefined) throw new ImportNotAllowed(file, specifier);
    return `${keyword}${quote}${path}${quote}`;
  });
}
