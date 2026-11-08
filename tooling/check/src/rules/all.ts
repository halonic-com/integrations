import type { CheckContext } from "../lib/context.ts";
import type { Report } from "../lib/problems.ts";
import { checkAbsolutePaths } from "./absolute-paths.ts";
import { checkDependencies } from "./dependencies.ts";
import { checkFileSize } from "./file-size.ts";
import { checkGoogleSheet } from "./google-sheet.ts";
import { checkLayers } from "./layers.ts";
import { checkLockfile } from "./lockfile.ts";
import { checkNames } from "./names.ts";
import { checkPackages } from "./packages.ts";

/** Every rule `pnpm check` runs, by name. */
export const rules: Readonly<Record<string, (context: CheckContext) => Report>> = {
  packages: checkPackages,
  layers: checkLayers,
  dependencies: checkDependencies,
  names: checkNames,
  "file-size": checkFileSize,
  lockfile: checkLockfile,
  "absolute-paths": checkAbsolutePaths,
  "google-sheet": checkGoogleSheet,
};
