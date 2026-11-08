import { existsSync } from "node:fs";
import { join } from "node:path";
import { type CheckContext, declaredDependencies } from "../lib/context.ts";
import { folderNamePattern, scope } from "../lib/layout.ts";
import { Report } from "../lib/problems.ts";
import type { WorkspacePackage } from "../lib/workspace.ts";

const guide = "See docs/guides/checks.md.";

/**
 * Checks each package's `package.json`: its name follows from its folder,
 * it is private unless listed as published, it declares its layer and
 * owner, it exposes only public entry points, and every internal
 * dependency uses `workspace:*` (plan 3.2, 4.1, 6.2).
 */
export function checkPackages(context: CheckContext): Report {
  const report = new Report("packages");
  for (const pkg of context.packages) {
    checkIdentity(context, pkg, report);
    checkInternalVersions(context, pkg, report);
    if (pkg.directory !== ".") {
      checkExports(context, pkg, report);
    }
  }
  return report;
}

function checkIdentity(context: CheckContext, pkg: WorkspacePackage, report: Report): void {
  const file = pkg.manifestPath;
  const { name, halonic } = pkg.manifest;
  const place = context.placeOf(pkg);
  if (place === undefined) {
    report.error(
      file,
      `Packages live only in integrations/<name> and tooling/<name>. Move this one. ${guide}`,
    );
    return;
  }
  const folder = pkg.directory.split("/").at(-1) ?? "";
  if (pkg.directory !== "." && !folderNamePattern.test(folder)) {
    report.error(file, `Folder name "${folder}" must be kebab-case, such as "llm-openai".`);
  }
  if (name !== place.expectedName) {
    report.error(
      file,
      `The name must be "${place.expectedName}" (it follows from the folder), not "${name ?? "(missing)"}".`,
    );
  }
  const published = name !== undefined && context.policy.published.includes(name);
  if (!published && pkg.manifest.private !== true) {
    report.error(
      file,
      `Add "private": true. Only the packages listed under "published" in ${context.policyPath} may be published (plan 3.2).`,
    );
  }
  if (halonic?.layer !== place.layer) {
    report.error(
      file,
      `Declare the layer: "halonic": { "layer": "${place.layer}" }. The folder puts this package in the ${place.layer} layer.`,
    );
  }
  if (typeof halonic?.owner !== "string" || halonic.owner.trim() === "") {
    report.error(
      file,
      `Name the owner who reviews changes: "halonic": { "owner": "<agent>" } (plan 6.2).`,
    );
  }
}

function checkInternalVersions(context: CheckContext, pkg: WorkspacePackage, report: Report): void {
  for (const dependency of declaredDependencies(pkg.manifest)) {
    const internal =
      dependency.name.startsWith(`${scope}/`) || context.packagesByName.has(dependency.name);
    if (!internal) {
      continue;
    }
    if (dependency.version !== "workspace:*") {
      report.error(
        pkg.manifestPath,
        `"${dependency.name}": "${dependency.version}" in ${dependency.field} must be "workspace:*". A version range lets pnpm look the name up on the registry, which is how dependency confusion happens (plan 3.2).`,
      );
    }
    if (!context.packagesByName.has(dependency.name)) {
      report.error(
        pkg.manifestPath,
        `"${dependency.name}" is not a package in this workspace. Fix the name or create the package with "pnpm new".`,
      );
    }
  }
}

/**
 * Lists the keys of an `exports` field, or `undefined` when it is missing
 * or not a subpath map.
 */
export function exportKeys(exportsField: unknown): string[] | undefined {
  if (typeof exportsField === "string") {
    return ["."];
  }
  if (exportsField === null || typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return undefined;
  }
  const keys = Object.keys(exportsField);
  return keys.every((key) => key.startsWith(".")) ? keys : ["."];
}

function checkExports(context: CheckContext, pkg: WorkspacePackage, report: Report): void {
  const place = context.placeOf(pkg);
  if (place === undefined || place.layer === "tooling") {
    return;
  }
  const keys = exportKeys(pkg.manifest.exports);
  const allowed = ["."];
  if (keys === undefined) {
    report.error(
      pkg.manifestPath,
      `Add an "exports" map with ${allowed.map((key) => `"${key}"`).join(" and ")}, so only the public entry points resolve (plan 4.1).`,
    );
    return;
  }
  for (const key of keys) {
    if (!allowed.includes(key)) {
      report.error(
        pkg.manifestPath,
        `"exports" may only contain ${allowed.join(" and ")}. "${key}" would let other packages import internals (plan 4.1).`,
      );
    }
  }
  const targets =
    typeof pkg.manifest.exports === "object" && pkg.manifest.exports !== null
      ? Object.values(pkg.manifest.exports as Record<string, unknown>)
      : [pkg.manifest.exports];
  for (const target of targets) {
    if (typeof target === "string" && !existsSync(join(context.root, pkg.directory, target))) {
      report.error(pkg.manifestPath, `"exports" points at ${target}, which doesn't exist.`);
    }
  }
}
