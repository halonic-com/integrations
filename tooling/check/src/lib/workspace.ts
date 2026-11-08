import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The parts of a `package.json` the checks read. */
export interface PackageJson {
  readonly name?: string;
  readonly private?: boolean;
  readonly exports?: unknown;
  readonly bin?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly halonic?: { readonly layer?: string; readonly owner?: string };
}

/** A package in the workspace, with its folder relative to the repo root. */
export interface WorkspacePackage {
  readonly directory: string;
  readonly manifestPath: string;
  readonly manifest: PackageJson;
}

/** The dependency fields of `package.json`, in the order we report them. */
export const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** One of the dependency fields of `package.json`. */
export type DependencyField = (typeof dependencyFields)[number];

/**
 * Finds the repo root: the nearest folder upwards with a `pnpm-workspace.yaml`.
 *
 * @throws when there is none, which means the check runs outside the repo
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let current = start;
  while (!existsSync(join(current, "pnpm-workspace.yaml"))) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`No pnpm-workspace.yaml found above ${start}. Run this inside the repo.`);
    }
    current = parent;
  }
  return current;
}

/**
 * Reads the `packages:` globs from `pnpm-workspace.yaml`. We only use plain
 * folders and `*` for whole folder names in a block list, so a line reader is enough and
 * keeps the check free of a YAML library. Anything else in `packages:`
 * throws: reading too few globs would hide packages from every rule.
 *
 * @throws when `packages:` is missing, empty, flow style or has a line this can't read
 */
export function readWorkspaceGlobs(root: string): string[] {
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split("\n");
  const fail = (reason: string): never => {
    throw new Error(
      `pnpm-workspace.yaml: ${reason} Write "packages:" as a block list of "- folder" or "- folder/*" lines, where "*" stands for one folder name.`,
    );
  };
  const globs: string[] = [];
  let inPackages = false;
  for (const [index, line] of lines.entries()) {
    if (/^packages:/.test(line)) {
      if (!/^packages:\s*(?:#.*)?$/.test(line)) {
        fail(`line ${index + 1} is not a block list.`);
      }
      inPackages = true;
      continue;
    }
    if (!inPackages || line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }
    const item = /^\s*-\s+(["']?)([^"'#\s[\]{},]+)\1\s*(?:#.*)?$/.exec(line);
    if (item?.[2] !== undefined) {
      globs.push(item[2]);
      continue;
    }
    if (/^[^\s-]/.test(line)) {
      break;
    }
    fail(`can't read line ${index + 1} of "packages:".`);
  }
  if (globs.length === 0) {
    fail(`"packages:" is missing or lists no folders.`);
  }
  return globs;
}

/** Lists every workspace package, the root package first. */
export function listWorkspacePackages(root: string): WorkspacePackage[] {
  const directories = ["."];
  for (const glob of readWorkspaceGlobs(root)) {
    directories.push(...expandWorkspaceGlob(root, glob));
  }
  const packages: WorkspacePackage[] = [];
  for (const directory of directories.sort(byRootFirst)) {
    const manifestPath = directory === "." ? "package.json" : `${directory}/package.json`;
    if (existsSync(join(root, manifestPath))) {
      packages.push({ directory, manifestPath, manifest: readJson(join(root, manifestPath)) });
    }
  }
  return packages;
}

/**
 * Expands a workspace glob in which `*` stands for one whole folder name:
 * `integrations/*` finds `integrations/mcp`, and a `*` for each of the two
 * folders below `integrations/tools` finds `integrations/tools/google/gmail`.
 * pnpm allows more, but this is all we use, and it keeps the check free of
 * a glob library. Like pnpm, it never looks inside `node_modules`.
 *
 * @throws on any other use of `*`, such as `**` or `llm-*`
 */
export function expandWorkspaceGlob(root: string, glob: string): string[] {
  let matches = [""];
  for (const segment of glob.split("/")) {
    if (segment.includes("*") && segment !== "*") {
      throw new Error(
        `Unsupported workspace glob "${glob}". Use "*" only for a whole folder name, as in "integrations/tools/*/*".`,
      );
    }
    matches = matches.flatMap((parent) =>
      segment === "*"
        ? subfolders(root, parent).map((name) => joinPath(parent, name))
        : [joinPath(parent, segment)],
    );
  }
  return matches;
}

function subfolders(root: string, directory: string): string[] {
  if (!existsSync(join(root, directory))) {
    return [];
  }
  return readdirSync(join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name);
}

function joinPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

function byRootFirst(left: string, right: string): number {
  if (left === ".") {
    return -1;
  }
  if (right === ".") {
    return 1;
  }
  return left.localeCompare(right);
}

/** Reads and parses a JSON file, naming the file when it isn't valid JSON. */
export function readJson<T>(path: string): T {
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * Lists the files git knows about (tracked plus new, not ignored), relative
 * to the root with forward slashes. Deleted files are left out.
 */
export function listRepoFiles(root: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const files = new Set(output.split("\0").filter((file) => file !== ""));
  return [...files].filter((file) => existsSync(join(root, file))).sort();
}

/** Finds the package that owns a file: the one with the longest matching folder. */
export function owningPackage(
  file: string,
  packages: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
  let best: WorkspacePackage | undefined;
  for (const candidate of packages) {
    const inside = candidate.directory === "." || file.startsWith(`${candidate.directory}/`);
    if (inside && (best === undefined || candidate.directory.length > best.directory.length)) {
      best = candidate;
    }
  }
  return best;
}
