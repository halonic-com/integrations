import { builtinModules } from "node:module";
import { posix } from "node:path";
import { type CheckContext, declaredDependencies } from "../lib/context.ts";
import type { Layer } from "../lib/layout.ts";
import { Report } from "../lib/problems.ts";
import { isSourceFile, isTestFile, splitBareSpecifier } from "../lib/source-files.ts";
import { owningPackage, type WorkspacePackage } from "../lib/workspace.ts";
import { exportKeys } from "./packages.ts";

const guide = "See docs/guides/dependencies.md.";

/** Where an edge comes from: a runtime dependency, or dev-only (devDependencies, tests, config files). */
type EdgeKind = "runtime" | "dev";

/**
 * Checks this repo's layer table for every internal `package.json`
 * dependency and every import in source files. Also catches relative
 * imports that leave their package, Node built-ins in integrations,
 * imports of undeclared packages and deep imports past `exports`.
 */
export function checkLayers(context: CheckContext): Report {
  const report = new Report("layers");
  for (const pkg of context.packages) {
    for (const dependency of declaredDependencies(pkg.manifest)) {
      const target = context.packagesByName.get(dependency.name);
      if (target === undefined) {
        continue;
      }
      const kind: EdgeKind = dependency.field === "devDependencies" ? "dev" : "runtime";
      const problem = layerProblem(context, pkg, target, kind);
      if (problem !== undefined) {
        report.error(
          pkg.manifestPath,
          `${pkg.manifest.name} depends on ${dependency.name}: ${problem} ${guide}`,
        );
      }
    }
  }
  for (const file of context.files) {
    if (isSourceFile(file) && !file.includes("/generated/")) {
      checkImports(context, file, report);
    }
  }
  return report;
}

/** True for test files and tool config files, which may use dev tooling. */
export function isDevFile(file: string): boolean {
  return isTestFile(file) || /(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(file);
}

function layerOf(context: CheckContext, pkg: WorkspacePackage): Layer | undefined {
  return context.placeOf(pkg)?.layer;
}

/** Explains why `from` may not use `to`, or returns `undefined` when it may. */
function layerProblem(
  context: CheckContext,
  from: WorkspacePackage,
  to: WorkspacePackage,
  kind: EdgeKind,
): string | undefined {
  const fromLayer = layerOf(context, from);
  const toLayer = layerOf(context, to);
  if (fromLayer === undefined || toLayer === undefined || from === to) {
    return undefined;
  }
  if (toLayer === "tooling" && fromLayer !== "tooling" && kind === "runtime") {
    return "tooling packages are dev-only. Move it to devDependencies.";
  }
  if (kind === "dev" && toLayer === "tooling") {
    return undefined;
  }
  return layerRule(fromLayer, toLayer);
}

function layerRule(fromLayer: Layer, toLayer: Layer): string | undefined {
  switch (fromLayer) {
    case "tooling":
      return toLayer === "tooling"
        ? undefined
        : "tooling packages use only other tooling packages.";
    case "integrations":
      return toLayer === "integrations"
        ? undefined
        : "integrations may use only other integrations' public entry points.";
  }
}

function checkImports(context: CheckContext, file: string, report: Report): void {
  const pkg = owningPackage(file, context.packages);
  if (pkg === undefined) {
    return;
  }
  const layer = layerOf(context, pkg);
  const dev = isDevFile(file);
  for (const reference of context.sourceFacts(file).imports) {
    const problem = importProblem(context, { file, pkg, layer, dev }, reference.specifier);
    if (problem !== undefined) {
      report.error(file, problem, reference.line);
    }
  }
}

interface ImportSite {
  readonly file: string;
  readonly pkg: WorkspacePackage;
  readonly layer: Layer | undefined;
  readonly dev: boolean;
}

function importProblem(
  context: CheckContext,
  site: ImportSite,
  specifier: string,
): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return relativeImportProblem(site, specifier);
  }
  if (specifier.startsWith("node:") || builtinModules.includes(specifier)) {
    return builtinProblem(site, specifier);
  }
  const { name, subpath } = splitBareSpecifier(specifier);
  const target = context.packagesByName.get(name);
  const declared = declaredDependencies(site.pkg.manifest).find(
    (dependency) => dependency.name === name,
  );
  if (declared === undefined && target !== site.pkg) {
    return `imports "${name}", which ${site.pkg.manifestPath} doesn't declare. Add it to package.json (an external one also needs an entry in dependencies.json).`;
  }
  if (target === undefined) {
    return externalImportProblem(context, site, name);
  }
  const kind: EdgeKind = site.dev ? "dev" : "runtime";
  const layerIssue = layerProblem(context, site.pkg, target, kind);
  if (layerIssue !== undefined) {
    return `imports ${name}: ${layerIssue}`;
  }
  return subpathProblem(site, target, name, subpath);
}

function relativeImportProblem(site: ImportSite, specifier: string): string | undefined {
  if (specifier.startsWith("/")) {
    return `imports the absolute path "${specifier}". Use a relative path inside the package, or the other package's name.`;
  }
  const resolved = posix.normalize(posix.join(posix.dirname(site.file), specifier));
  const inside = site.pkg.directory === "." || resolved.startsWith(`${site.pkg.directory}/`);
  if (!inside) {
    return `"${specifier}" reaches outside ${site.pkg.manifest.name}. Import the other package by name through its public entry point.`;
  }
  return undefined;
}

function builtinProblem(site: ImportSite, specifier: string): string | undefined {
  if (site.dev) {
    return undefined;
  }
  if (site.layer === "integrations") {
    return `integrations also run in the cloud runtime and may not use Node APIs ("${specifier}"). Use what the integration kit provides, such as context.http (plan 15.2).`;
  }
  return undefined;
}

function externalImportProblem(
  context: CheckContext,
  site: ImportSite,
  name: string,
): string | undefined {
  const approved = context.dependencyList.dependencies[name];
  if (approved?.category === "dev-tooling" && !site.dev && site.layer !== "tooling") {
    return `"${name}" is dev tooling and may only be imported from tests and config files.`;
  }
  return undefined;
}

function subpathProblem(
  site: ImportSite,
  target: WorkspacePackage,
  name: string,
  subpath: string,
): string | undefined {
  if (target === site.pkg) {
    return `imports its own package by name. Use a relative import inside a package.`;
  }
  const keys = exportKeys(target.manifest.exports) ?? ["."];
  const exported = keys.some((key) => key === subpath || matchesExportPattern(key, subpath));
  if (!exported) {
    return `"${name}${subpath === "." ? "" : subpath.slice(1)}" is not a public entry point of ${name}. Use one of: ${keys.join(", ")}.`;
  }
  return undefined;
}

function matchesExportPattern(key: string, subpath: string): boolean {
  const star = key.indexOf("*");
  if (star === -1) {
    return false;
  }
  return subpath.startsWith(key.slice(0, star)) && subpath.endsWith(key.slice(star + 1));
}
