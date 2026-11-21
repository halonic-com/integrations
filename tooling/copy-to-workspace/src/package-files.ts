import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

/** The parts of a `package.json` the copy reads. */
interface PackageJson {
  readonly name: string;
  readonly exports?: string | Readonly<Record<string, ExportTarget>>;
  readonly dependencies?: Readonly<Record<string, string>>;
}

type ExportTarget = string | { readonly import?: string; readonly default?: string };

/** One package an integration needs at run time. */
export interface RuntimePackage {
  /** The npm name, such as `@halonicjs/adapters`. */
  readonly name: string;
  /** Its folder, with links resolved. */
  readonly folder: string;
  /** Whether it is a package of this repo, with TypeScript sources, or a built one from npm. */
  readonly source: "workspace" | "npm";
  /** The file each export names, relative to the package folder, such as `./src/index.ts`. */
  readonly exports: ReadonlyMap<string, string>;
}

/** The one dependency the runner resolves itself; it's copied whole, never rewritten. */
export const zodName = "zod";

/**
 * Reads the package in `folder` and the packages it needs at run time, its
 * own `dependencies` and theirs, each once. `zod` is left out: the runner
 * resolves it from the folder's `node_modules`.
 *
 * @example
 * runtimePackages("integrations/tools/paperclip/issues").map((p) => p.name);
 * // ["@halonicjs/integration-tool-paperclip-issues", "@halonicjs/adapters", "@halonicjs/integration-shared"]
 */
export function runtimePackages(folder: string): RuntimePackage[] {
  const found = new Map<string, RuntimePackage>();
  const visit = (packageFolder: string, source: RuntimePackage["source"]) => {
    const json = readPackageJson(packageFolder);
    if (found.has(json.name)) return;
    found.set(json.name, {
      name: json.name,
      folder: packageFolder,
      source,
      exports: exportsOf(json),
    });
    for (const [name, version] of Object.entries(json.dependencies ?? {})) {
      if (name === zodName) continue;
      const dependency = realpathSync(join(packageFolder, "node_modules", name));
      visit(dependency, version.startsWith("workspace:") ? "workspace" : "npm");
    }
  };
  visit(realpathSync(folder), "workspace");
  return [...found.values()];
}

/** The folder of `zod` as the package in `folder` gets it, with links resolved. */
export function zodFolder(folder: string): string {
  return realpathSync(join(folder, "node_modules", zodName));
}

function readPackageJson(folder: string): PackageJson {
  return JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as PackageJson;
}

/** Each export's file: a plain string, or the `import` or `default` condition. */
function exportsOf(json: PackageJson): ReadonlyMap<string, string> {
  const exports = typeof json.exports === "string" ? { ".": json.exports } : (json.exports ?? {});
  const files = new Map<string, string>();
  for (const [path, target] of Object.entries(exports)) {
    const file = typeof target === "string" ? target : (target.import ?? target.default);
    if (file !== undefined) files.set(path, file);
  }
  return files;
}
