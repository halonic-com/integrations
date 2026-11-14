import { existsSync } from "node:fs";
import { join } from "node:path";
import { type CheckContext, declaredDependencies } from "../lib/context.ts";
import { folderNamePattern, groupClaiming, scope } from "../lib/layout.ts";
import { Report } from "../lib/problems.ts";
import { readCatalog, type WorkspacePackage } from "../lib/workspace.ts";

const guide = "See docs/guides/checks.md.";
const places =
  "integrations/<name>, integrations/models/<provider>, integrations/knowledge/<source>, integrations/tools/<provider>/<service> and tooling/<name>";

/**
 * Checks each package's `package.json`: its name follows from its folder,
 * it is private unless listed as published, it declares its layer and
 * owner, it exposes only public entry points, and every internal
 * dependency uses `workspace:*` (plan 3.2, 4.1, 6.2). A package from the
 * main repo (`fromMainRepo` in the policy) comes from npm instead, with an
 * exact version in the catalog. Also finds packages under `integrations/`
 * that pnpm doesn't see, and names used twice.
 */
export function checkPackages(context: CheckContext): Report {
  const report = new Report("packages");
  checkUnseenPackages(context, report);
  checkDuplicateNames(context, report);
  checkMainRepoPins(context, report);
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
    report.error(file, misplacedMessage(pkg.directory));
    return;
  }
  const folders = pkg.directory === "." ? [] : pkg.directory.split("/");
  for (const folder of folders.filter((folder) => !folderNamePattern.test(folder))) {
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

function misplacedMessage(directory: string): string {
  const [top, folder, ...below] = directory.split("/");
  const group = folder === undefined ? undefined : groupClaiming(folder);
  if (top === "integrations" && below.length === 0 && group !== undefined) {
    return `"${folder}" starts with a name kept for integrations/${group}/, and would clash with a package there. Move it into integrations/${group}/, or rename the folder. ${guide}`;
  }
  return `Packages live only in ${places}. Move this one. ${guide}`;
}

/**
 * Two folders can give the same name, such as `tools/google-cloud/storage`
 * and `tools/google/cloud-storage`. pnpm doesn't refuse that, and the rules
 * that look a package up by name would see only one of them.
 */
function checkDuplicateNames(context: CheckContext, report: Report): void {
  const packagesByName = new Map<string, WorkspacePackage[]>();
  for (const pkg of context.packages) {
    const name = pkg.manifest.name;
    if (name !== undefined) {
      packagesByName.set(name, [...(packagesByName.get(name) ?? []), pkg]);
    }
  }
  for (const [name, sameName] of packagesByName) {
    for (const pkg of sameName) {
      const others = sameName.filter((other) => other !== pkg).map((other) => other.directory);
      if (others.length > 0) {
        report.error(
          pkg.manifestPath,
          `"${name}" is also the name of the package in ${others.join(" and ")}. Every package needs its own name, so rename one of the folders. ${guide}`,
        );
      }
    }
  }
}

/**
 * A `package.json` under `integrations/` that matches no workspace glob is
 * invisible to pnpm, so nothing would build, test or check it. That happens
 * when a folder level is missing or extra, such as `integrations/google/gmail`
 * instead of `integrations/tools/google/gmail`.
 */
function checkUnseenPackages(context: CheckContext, report: Report): void {
  const seen = new Set(context.packages.map((pkg) => pkg.manifestPath));
  for (const file of context.files) {
    if (file.startsWith("integrations/") && file.endsWith("/package.json") && !seen.has(file)) {
      report.error(
        file,
        `pnpm doesn't see this package, because its folder matches no line under "packages:" in pnpm-workspace.yaml. Move it to one of ${places}. ${guide}`,
      );
    }
  }
}

/** An exact version such as `0.1.0` or `1.2.0-beta.1`: no range, tag or `workspace:`. */
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Our packages from the main repo (`@halonicjs/adapters`,
 * `@halonicjs/testing`) are the one place this repo takes our own scope
 * from npm. Each takes its version from the catalog, and the catalog pins
 * it exactly, so a new release only arrives in a pull request that a
 * person reviews. The dependencies rule checks the `catalog:` part.
 */
function checkMainRepoPins(context: CheckContext, report: Report): void {
  const used = new Set(
    context.packages.flatMap((pkg) =>
      declaredDependencies(pkg.manifest).map((dependency) => dependency.name),
    ),
  );
  const fromMainRepo = context.policy.fromMainRepo.filter((name) => used.has(name));
  if (fromMainRepo.length === 0) {
    return;
  }
  const catalog = readCatalog(context.read("pnpm-workspace.yaml"));
  for (const name of fromMainRepo) {
    const version = catalog.get(name);
    if (version === undefined) {
      report.error(
        "pnpm-workspace.yaml",
        `"${name}" comes from the main repo, so add it to "catalog:" with an exact version, such as "${name}": 0.1.0. ${guide}`,
      );
    } else if (!exactVersion.test(version)) {
      report.error(
        "pnpm-workspace.yaml",
        `"${name}" comes from the main repo and needs an exact version in "catalog:", not "${version}". A range would take a new release without a review (plan 3.2).`,
      );
    }
  }
}

function checkInternalVersions(context: CheckContext, pkg: WorkspacePackage, report: Report): void {
  for (const dependency of declaredDependencies(pkg.manifest)) {
    if (context.policy.fromMainRepo.includes(dependency.name)) {
      if (dependency.version.startsWith("workspace:")) {
        report.error(
          pkg.manifestPath,
          `"${dependency.name}" comes from the main repo on npm, not from this workspace. Use "catalog:". ${guide}`,
        );
      }
      continue;
    }
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
