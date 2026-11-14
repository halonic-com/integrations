import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PackagePlace, placeOf } from "./layout.ts";
import { isSourceFile, readSourceFacts, type SourceFacts } from "./source-files.ts";
import {
  type DependencyField,
  dependencyFields,
  listRepoFiles,
  listWorkspacePackages,
  type PackageJson,
  readJson,
  type WorkspacePackage,
} from "./workspace.ts";

/**
 * What an entry in `dependencies.json` is for (plan 7.1). `general` is Zod
 * alone: the one library the user allows outside connector code.
 * `main-repo` is our own code published from halonic-com/halonic, such as
 * the integration kit; the policy's `fromMainRepo` lists the same names.
 */
export type DependencyCategory = "outside-world" | "general" | "main-repo" | "dev-tooling";

/** One approved external dependency. */
export interface ApprovedDependency {
  readonly category: DependencyCategory;
  readonly allowedIn: readonly string[];
  readonly reason: string;
}

/** The contents of `tooling/check/dependencies.json`. */
export interface DependencyList {
  readonly dependencies: Readonly<Record<string, ApprovedDependency>>;
}

/** The contents of `tooling/check/policy.json`. */
export interface Policy {
  readonly published: readonly string[];
  /** Our packages from the main repo, taken from npm with an exact version instead of `workspace:*`. */
  readonly fromMainRepo: readonly string[];
  readonly fileSize: {
    readonly warnLines: number;
    readonly maxLines: number;
    readonly warnFunctionLines: number;
  };
}

/** Everything the rules look at, read once per run. */
export interface CheckContext {
  readonly root: string;
  readonly files: readonly string[];
  readonly packages: readonly WorkspacePackage[];
  readonly packagesByName: ReadonlyMap<string, WorkspacePackage>;
  readonly policy: Policy;
  readonly dependencyList: DependencyList;
  readonly policyPath: string;
  readonly dependencyListPath: string;
  /** The layer and expected name of a package, from its folder. */
  placeOf(pkg: WorkspacePackage): PackagePlace | undefined;
  /** The text of a repo file, read once. */
  read(file: string): string;
  /** The imports and functions of a source file, parsed once. */
  sourceFacts(file: string): SourceFacts;
}

/** Reads the repo once and returns the context every rule shares. */
export function loadContext(root: string): CheckContext {
  const policyPath = "tooling/check/policy.json";
  const dependencyListPath = "tooling/check/dependencies.json";
  const packages = listWorkspacePackages(root);
  const packagesByName = new Map<string, WorkspacePackage>();
  for (const pkg of packages) {
    if (pkg.manifest.name !== undefined) {
      packagesByName.set(pkg.manifest.name, pkg);
    }
  }
  const texts = new Map<string, string>();
  const facts = new Map<string, SourceFacts>();
  const read = (file: string): string => {
    let text = texts.get(file);
    if (text === undefined) {
      text = readFileSync(join(root, file), "utf8");
      texts.set(file, text);
    }
    return text;
  };
  return {
    root,
    files: listRepoFiles(root),
    packages,
    packagesByName,
    policy: readJson<Policy>(join(root, policyPath)),
    dependencyList: readJson<DependencyList>(join(root, dependencyListPath)),
    policyPath,
    dependencyListPath,
    placeOf: (pkg) => placeOf(pkg.directory),
    read,
    sourceFacts(file) {
      if (!isSourceFile(file)) {
        return { imports: [], functions: [] };
      }
      let found = facts.get(file);
      if (found === undefined) {
        found = readSourceFacts(file, read(file));
        facts.set(file, found);
      }
      return found;
    },
  };
}

/** True when a package name matches an `allowedIn` pattern, where `*` matches any text. */
export function matchesNamePattern(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(name);
}

/** All dependencies a manifest declares, with the field each one is in. */
export function declaredDependencies(
  manifest: PackageJson,
): { name: string; version: string; field: DependencyField }[] {
  const result: { name: string; version: string; field: DependencyField }[] = [];
  for (const field of dependencyFields) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      result.push({ name, version, field });
    }
  }
  return result;
}
