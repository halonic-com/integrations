import type { CheckContext } from "../lib/context.ts";
import { Report } from "../lib/problems.ts";
import type { WorkspacePackage } from "../lib/workspace.ts";

const guide = "See docs/guides/integrations.md.";
const integrationPreset = "@halonicjs/tooling-config/tsconfig/integration.json";
const nodePreset = "@halonicjs/tooling-config/tsconfig/node.json";
const testFiles = "src/**/*.test.ts";
const testFolder = "src/test";

/** The parts of a `tsconfig.json` this rule reads. */
interface TsConfig {
  readonly extends?: unknown;
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
  checkIncluded(file, config, report);
  checkExcluded(file, config, hasTestFolder(context, pkg), report);
}

/** The library config may not pull in the Vitest config or tests, which use Node types. */
function checkIncluded(file: string, config: TsConfig, report: Report): void {
  for (const entry of [...stringList(config.include), ...stringList(config.files)]) {
    if (isVitestConfig(entry)) {
      report.error(
        file,
        `Remove "${entry}": the Vitest config uses Node types. tsconfig.test.json covers it. ${guide}`,
      );
    }
    if (isTestPath(entry)) {
      report.error(
        file,
        `Remove "${entry}": tests may use Node types. tsconfig.test.json covers them. ${guide}`,
      );
    }
  }
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

function hasTestFolder(context: CheckContext, pkg: WorkspacePackage): boolean {
  const prefix = `${pkg.directory}/${testFolder}/`;
  return context.files.some((file) => file.startsWith(prefix));
}
