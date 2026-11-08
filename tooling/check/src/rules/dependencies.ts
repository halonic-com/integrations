import { type CheckContext, declaredDependencies, matchesNamePattern } from "../lib/context.ts";
import { Report } from "../lib/problems.ts";
import type { DependencyField, WorkspacePackage } from "../lib/workspace.ts";

const guide = "See docs/guides/dependencies.md.";
const categories = new Set(["outside-world", "general", "dev-tooling"]);

interface ExternalDependency {
  readonly name: string;
  readonly version: string;
  readonly field: DependencyField;
}

/**
 * Checks every external dependency against `dependencies.json` (plan 7.1
 * and 7.4): it must be listed, used only in its allowed packages, take its
 * version from the catalog, and dev tooling stays in devDependencies.
 */
export function checkDependencies(context: CheckContext): Report {
  const report = new Report("dependencies");
  const used = new Set<string>();
  for (const pkg of context.packages) {
    for (const dependency of declaredDependencies(pkg.manifest)) {
      const internal =
        context.packagesByName.has(dependency.name) || dependency.version.startsWith("workspace:");
      if (!internal) {
        used.add(dependency.name);
        checkOne(context, pkg, dependency, report);
      }
    }
  }
  checkList(context, used, report);
  return report;
}

function checkOne(
  context: CheckContext,
  pkg: WorkspacePackage,
  dependency: ExternalDependency,
  report: Report,
): void {
  const packageName = pkg.manifest.name ?? pkg.directory;
  const approved = context.dependencyList.dependencies[dependency.name];
  if (approved === undefined) {
    report.error(
      pkg.manifestPath,
      `"${dependency.name}" isn't in ${context.dependencyListPath}. Adding a dependency is a decision: add an entry with category, allowedIn and reason, and get Liam's approval in the pull request. ${guide}`,
    );
    return;
  }
  if (!approved.allowedIn.some((pattern) => matchesNamePattern(packageName, pattern))) {
    report.error(
      pkg.manifestPath,
      `"${dependency.name}" is approved only for ${approved.allowedIn.join(", ")}, not ${packageName}. ${guide}`,
    );
  }
  if (!dependency.version.startsWith("catalog:")) {
    report.error(
      pkg.manifestPath,
      `"${dependency.name}": "${dependency.version}" must be "catalog:". Put the version once in the catalog in pnpm-workspace.yaml (plan 7.4).`,
    );
  }
  if (approved.category === "dev-tooling" && dependency.field !== "devDependencies") {
    report.error(
      pkg.manifestPath,
      `"${dependency.name}" is dev tooling and belongs in devDependencies; it must never ship (plan 7.1).`,
    );
  }
}

function checkList(context: CheckContext, used: ReadonlySet<string>, report: Report): void {
  for (const [name, entry] of Object.entries(context.dependencyList.dependencies)) {
    if (!categories.has(entry.category)) {
      report.error(
        context.dependencyListPath,
        `"${name}" has an unknown category "${entry.category}". Use one of: ${[...categories].join(", ")}.`,
      );
    }
    if (entry.reason.trim() === "") {
      report.error(context.dependencyListPath, `"${name}" needs a reason.`);
    }
    if (!used.has(name)) {
      report.warning(
        context.dependencyListPath,
        `"${name}" is listed but no package uses it. Remove the entry if it's no longer needed.`,
      );
    }
  }
}
