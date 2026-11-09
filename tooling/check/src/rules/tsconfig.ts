import type { CheckContext } from "../lib/context.ts";
import { Report } from "../lib/problems.ts";
import type { WorkspacePackage } from "../lib/workspace.ts";

const guide = "See docs/guides/integrations.md.";
const integrationPreset = "@halonicjs/tooling-config/tsconfig/integration.json";
const nodePreset = "@halonicjs/tooling-config/tsconfig/node.json";
const testFiles = "src/**/*.test.ts";
const testFolder = "src/test";
const libraryFolder = "src";
const recordedScenarios = "recordings/scenarios.ts";

/** The parts of a `tsconfig.json` this rule reads. */
interface TsConfig {
  readonly extends?: unknown;
  readonly compilerOptions?: unknown;
  readonly include?: unknown;
  readonly exclude?: unknown;
  readonly files?: unknown;
}

/**
 * Keeps Node types out of integration library code. Each integration has
 * two configs: `tsconfig.json` on the `integration` preset, which has no
 * Node types and covers only the library, and `tsconfig.test.json` on the
 * `node` preset for the tests and the Vitest config. Its `typecheck` script
 * runs both, so a Node API in library code fails the typecheck, not only
 * the `layers` rule.
 */
export function checkTsconfig(context: CheckContext): Report {
  const report = new Report("tsconfig");
  for (const pkg of context.packages) {
    if (context.placeOf(pkg)?.layer === "integrations") {
      checkLibraryConfig(context, pkg, report);
      checkTestConfig(context, pkg, report);
      checkTypecheckScript(pkg, report);
    }
  }
  return report;
}

function checkLibraryConfig(context: CheckContext, pkg: WorkspacePackage, report: Report): void {
  const file = `${pkg.directory}/tsconfig.json`;
  const config = readConfig(context, file, report);
  if (config === undefined) {
    return;
  }
  if (config.extends !== integrationPreset) {
    report.error(
      file,
      `"extends" must be "${integrationPreset}", the preset without Node types. ${guide}`,
    );
  }
  checkNoCompilerOptions(file, config, report);
  checkIncluded(file, config, report);
  checkExcluded(file, config, hasTestFolder(context, pkg), report);
}

/**
 * Options here override the preset, so `"types": ["node"]` or `"lib": ["dom"]`
 * would bring Node or browser types back. The preset is the only source.
 */
function checkNoCompilerOptions(file: string, config: TsConfig, report: Report): void {
  if (config.compilerOptions !== undefined) {
    report.error(
      file,
      `Remove "compilerOptions": the integration preset sets them, and options here could bring Node types back. ${guide}`,
    );
  }
}

/**
 * The library config lists exactly what it compiles. Without `include`, tsc
 * compiles every file in the folder, the Vitest config and tests among them,
 * which use Node types. So `include` is required, and it and `files` may only
 * name `src`, paths in `src` other than tests, and the recorded scenarios.
 */
function checkIncluded(file: string, config: TsConfig, report: Report): void {
  const include = stringList(config.include);
  if (include.length === 0) {
    report.error(
      file,
      `Add "include": ["${libraryFolder}"]. Without it tsc compiles every file in the folder. ${guide}`,
    );
  }
  for (const entry of [...include, ...stringList(config.files)]) {
    const problem = whyNotAllowed(entry);
    if (problem !== undefined) {
      report.error(file, `Remove "${entry}": ${problem} ${guide}`);
    }
  }
}

/** Says why the library config may not include an entry, or `undefined` if it may. */
function whyNotAllowed(entry: string): string | undefined {
  if (isVitestConfig(entry)) {
    return "the Vitest config uses Node types. tsconfig.test.json covers it.";
  }
  if (isTestPath(entry)) {
    return "tests may use Node types. tsconfig.test.json covers them.";
  }
  if (!isLibraryPath(entry)) {
    return `only "${libraryFolder}", paths in it and "${recordedScenarios}" may be included.`;
  }
  return undefined;
}

/** Including `src` brings in the tests too, so the library config must exclude them. */
function checkExcluded(
  file: string,
  config: TsConfig,
  testFolderExists: boolean,
  report: Report,
): void {
  const exclude = stringList(config.exclude);
  const needed = testFolderExists ? [testFiles, testFolder] : [testFiles];
  for (const entry of needed.filter((entry) => !exclude.includes(entry))) {
    report.error(
      file,
      `Add "${entry}" to "exclude": tests may use Node types. tsconfig.test.json covers them. ${guide}`,
    );
  }
}

function checkTestConfig(context: CheckContext, pkg: WorkspacePackage, report: Report): void {
  const file = `${pkg.directory}/tsconfig.test.json`;
  const config = readConfig(context, file, report);
  if (config !== undefined && config.extends !== nodePreset) {
    report.error(file, `"extends" must be "${nodePreset}", the preset for tests. ${guide}`);
  }
}

function checkTypecheckScript(pkg: WorkspacePackage, report: Report): void {
  const script = pkg.manifest.scripts?.["typecheck"] ?? "";
  const checksLibrary = /(?:^|\s)(?:-p|--project)\s+(?:\.|tsconfig\.json)(?=\s|;|&|$)/.test(script);
  const checksTests = /(?:^|\s)(?:-p|--project)\s+tsconfig\.test\.json(?=\s|;|&|$)/.test(script);
  if (!checksLibrary || !checksTests) {
    report.error(
      pkg.manifestPath,
      `The "typecheck" script must check both configs: "tsc --noEmit -p . && tsc --noEmit -p tsconfig.test.json". ${guide}`,
    );
  }
}

/** Reads a config, or reports why it can't and returns `undefined`. */
function readConfig(context: CheckContext, file: string, report: Report): TsConfig | undefined {
  if (!context.files.includes(file)) {
    report.error(file, `Add this file. ${guide}`);
    return undefined;
  }
  try {
    const config: unknown = JSON.parse(context.read(file));
    if (config !== null && typeof config === "object" && !Array.isArray(config)) {
      return config;
    }
  } catch {
    // Reported below, like any other config that isn't an object.
  }
  report.error(file, "This must be a JSON object, without comments.");
  return undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function normalise(entry: string): string {
  return entry.replace(/^\.\//, "").replace(/\/$/, "");
}

function isVitestConfig(entry: string): boolean {
  return /(?:^|\/)vitest\.config\.[cm]?[jt]s$/.test(normalise(entry));
}

function isTestPath(entry: string): boolean {
  const path = normalise(entry);
  return (
    path === testFolder || path.startsWith(`${testFolder}/`) || /\.test\.[cm]?[jt]sx?$/.test(path)
  );
}

/** `src`, a path in it, or the recorded scenarios, without `..` to climb back out. */
function isLibraryPath(entry: string): boolean {
  const path = normalise(entry);
  if (path.split("/").includes("..")) {
    return false;
  }
  return (
    path === libraryFolder || path.startsWith(`${libraryFolder}/`) || path === recordedScenarios
  );
}

function hasTestFolder(context: CheckContext, pkg: WorkspacePackage): boolean {
  const prefix = `${pkg.directory}/${testFolder}/`;
  return context.files.some((file) => file.startsWith(prefix));
}
