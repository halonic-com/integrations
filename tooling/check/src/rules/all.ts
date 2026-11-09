import type { CheckContext } from "../lib/context.ts";
import type { Report } from "../lib/problems.ts";
import { checkAbsolutePaths } from "./absolute-paths.ts";
import { checkAdvisories } from "./advisories.ts";
import { checkDependencies } from "./dependencies.ts";
import { checkFileSize } from "./file-size.ts";
import { checkGoogleSheet } from "./google-sheet.ts";
import { checkIntegrationTypes } from "./integration-types.ts";
import { checkLayers } from "./layers.ts";
import { checkLockfile } from "./lockfile.ts";
import { checkNames } from "./names.ts";
import { checkPackages } from "./packages.ts";
import { checkTsconfig } from "./tsconfig.ts";

/** Every rule `pnpm check` runs, by name. */
export const rules: Readonly<Record<string, (context: CheckContext) => Report>> = {
  packages: checkPackages,
  layers: checkLayers,
  dependencies: checkDependencies,
  advisories: (context) => checkAdvisories(context),
  names: checkNames,
  "file-size": checkFileSize,
  lockfile: checkLockfile,
  "absolute-paths": checkAbsolutePaths,
  "google-sheet": checkGoogleSheet,
  tsconfig: checkTsconfig,
  "integration-types": checkIntegrationTypes,
};
