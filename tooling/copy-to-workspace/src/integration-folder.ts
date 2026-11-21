import { execFileSync } from "node:child_process";
import { cpSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { FolderError } from "./folder-error.ts";
import { rewriteImports } from "./imports.ts";
import { type RuntimePackage, runtimePackages, zodFolder } from "./package-files.ts";

/**
 * Builds the folder Halonic runs as a local integration, from an
 * integration in this repo, into `out` (which must be empty or missing):
 *
 * ```text
 * integration.yaml          the permission sheet, as it is
 * backend/index.js          the entry Halonic starts; its default export is the integration
 * backend/packages/<name>/  the integration and every package it needs, built to JavaScript
 * node_modules/zod/         the one package the runner resolves itself
 * ```
 *
 * Every package import is turned into a path inside the folder, because the
 * runner allows only the folder's own files and `zod`.
 *
 * @param integration - the integration's folder in this repo
 * @param id - the sheet's `id`, which the integration's `name` must match
 * @throws {FolderError} when it can't be built
 */
export async function buildIntegrationFolder(
  integration: string,
  id: string,
  out: string,
): Promise<void> {
  const packages = runtimePackages(integration);
  const [own] = packages;
  if (own === undefined) throw new FolderError(`${integration} has no package.json.`);
  const packagesFolder = join(out, "backend", "packages");
  for (const runtime of packages) {
    copyPackage(runtime, join(packagesFolder, folderName(runtime)));
  }
  rewritePackageImports(packages, packagesFolder);
  cpSync(zodFolder(integration), join(out, "node_modules", "zod"), {
    recursive: true,
    dereference: true,
  });
  cpSync(join(integration, "integration.yaml"), join(out, "integration.yaml"));
  const entry = join(packagesFolder, folderName(own), entryFile(own));
  const exportName = await integrationExport(entry, id);
  const fromBackend = `./${toPosix(relative(join(out, "backend"), entry))}`;
  writeFileSync(
    join(out, "backend", "index.js"),
    `// Written by pnpm copy-to-workspace: Halonic starts the default export.\nexport { ${exportName} as default } from "${fromBackend}";\n`,
  );
}

/** `@halonicjs/integration-shared` gets the folder `integration-shared`. */
function folderName(runtime: RuntimePackage): string {
  return runtime.name.replace(/^@halonicjs\//, "").replaceAll("/", "-");
}

/** A package of this repo is built with its own tsconfig; a package from npm is already built. */
function copyPackage(runtime: RuntimePackage, out: string): void {
  if (runtime.source === "npm") {
    cpSync(runtime.folder, out, {
      recursive: true,
      dereference: true,
      filter: (file) => !relative(runtime.folder, file).split(sep).includes("node_modules"),
    });
    return;
  }
  try {
    execFileSync(
      join(runtime.folder, "node_modules", ".bin", "tsc"),
      [
        ...["-p", "tsconfig.json", "--outDir", out, "--rootDir", "src"],
        ...["--noEmit", "false", "--noEmitOnError", "true", "--rewriteRelativeImportExtensions"],
        ...["--declaration", "false", "--declarationMap", "false", "--sourceMap", "false"],
      ],
      { cwd: runtime.folder, stdio: "pipe" },
    );
  } catch (error) {
    const output = (error as { stdout?: Buffer }).stdout?.toString() ?? "";
    throw new FolderError(`${runtime.name} doesn't build:\n${output}`);
  }
}

/** The file of the package's `.` export, inside its copy. */
function entryFile(runtime: RuntimePackage, path = "."): string {
  const file = runtime.exports.get(path);
  if (file === undefined) {
    throw new FolderError(`${runtime.name} has no export "${path}".`);
  }
  // A package of this repo exports its TypeScript sources; its copy holds them built.
  return runtime.source === "workspace"
    ? file.replace(/^\.\/src\//, "").replace(/\.ts$/, ".js")
    : file.replace(/^\.\//, "");
}

function rewritePackageImports(packages: readonly RuntimePackage[], packagesFolder: string): void {
  // Longest name first, so `@halonicjs/adapters` never takes an import of `@halonicjs/adapters-x`.
  const byName = [...packages].sort((a, b) => b.name.length - a.name.length);
  const target = (specifier: string): string | undefined => {
    const runtime = byName.find(
      (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
    );
    if (runtime === undefined) return undefined;
    const path = specifier === runtime.name ? "." : `.${specifier.slice(runtime.name.length)}`;
    if (!runtime.exports.has(path)) return undefined;
    return join(packagesFolder, folderName(runtime), entryFile(runtime, path));
  };
  for (const file of globSync("**/*.js", { cwd: packagesFolder })) {
    const absolute = join(packagesFolder, file);
    const code = readFileSync(absolute, "utf8");
    const rewritten = rewriteImports(code, file, (specifier) => {
      const found = target(specifier);
      if (found === undefined) return undefined;
      const path = toPosix(relative(dirname(absolute), found));
      return path.startsWith(".") ? path : `./${path}`;
    });
    if (rewritten !== code) writeFileSync(absolute, rewritten);
  }
}

/**
 * The name of the entry's export that is the integration: the one whose
 * `name` is the sheet's `id`. Loading it runs no tool and calls nothing:
 * an integration does its work in `connect`.
 */
async function integrationExport(entry: string, id: string): Promise<string> {
  const module = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
  const names = Object.entries(module)
    .filter(([, value]) => isIntegrationNamed(value, id))
    .map(([name]) => name);
  if (names.length !== 1) {
    throw new FolderError(
      `The integration's index.ts must export exactly one integration named "${id}", the sheet's id; it exports ${names.length}.`,
    );
  }
  return names[0] as string;
}

function isIntegrationNamed(value: unknown, id: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { name?: unknown; connect?: unknown };
  return candidate.name === id && typeof candidate.connect === "function";
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}
