import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CheckContext } from "../lib/context.ts";
import { Report } from "../lib/problems.ts";

const lockfile = "pnpm-lock.yaml";

/** One entry of the lockfile's `packages:` section, with the lines we look at. */
export interface LockedPackage {
  readonly key: string;
  readonly line: number;
  readonly resolution: string | undefined;
  /** True in the lockfile document that pins pnpm itself (`packageManagerDependencies`). */
  readonly forPackageManager?: boolean;
}

/** The `packages:` section of a lockfile: its entries, and the lines that fit no known shape. */
export interface LockedPackages {
  readonly entries: LockedPackage[];
  readonly unreadableLines: number[];
}

/** Where every registry package must come from (plan 3.2). */
export const npmRegistry = "https://registry.npmjs.org/";

/**
 * Reads the `packages:` section of a pnpm v9 lockfile. The format is
 * regular (two-space keys, four-space fields, deeper lines inside a block
 * field), so a line reader keeps this check free of a YAML library. Any
 * other line, such as a whole entry in flow style, is reported as
 * unreadable so the check fails closed instead of skipping it.
 */
export function readLockedPackages(text: string): LockedPackages {
  const state: EntryState = { entries: [], inBlockField: false, collectingResolution: false };
  const unreadableLines: number[] = [];
  let inPackages = false;
  let forPackageManager = false;
  text.split("\n").forEach((line, index) => {
    if (line === "---") {
      forPackageManager = false;
    }
    if (/^ {4}packageManagerDependencies:/.test(line)) {
      forPackageManager = true;
    }
    if (/^\S/.test(line)) {
      inPackages = line.startsWith("packages:");
      return;
    }
    if (
      inPackages &&
      line.trim() !== "" &&
      !readEntryLine(state, line, index + 1, forPackageManager)
    ) {
      unreadableLines.push(index + 1);
    }
  });
  return { entries: state.entries, unreadableLines };
}

interface EntryState {
  readonly entries: LockedPackage[];
  current?: LockedPackage & { resolution: string | undefined };
  inBlockField: boolean;
  collectingResolution: boolean;
}

/** Reads one line of `packages:` into the state; false when it fits no known shape. */
function readEntryLine(
  state: EntryState,
  line: string,
  lineNumber: number,
  forPackageManager: boolean,
): boolean {
  const key = /^ {2}(['"]?)([^ '"].*)\1:\s*$/.exec(line);
  if (key?.[2] !== undefined) {
    state.current = { key: key[2], line: lineNumber, resolution: undefined, forPackageManager };
    state.inBlockField = false;
    state.collectingResolution = false;
    state.entries.push(state.current);
    return true;
  }
  const { current } = state;
  if (current === undefined) {
    return false;
  }
  if (state.inBlockField && /^ {6,}\S/.test(line)) {
    // A multi-line resolution (the Node runtime) continues at deeper indentation.
    if (state.collectingResolution) {
      current.resolution = `${current.resolution ?? ""}\n${line.trim()}`;
    }
    return true;
  }
  const field = /^ {4}([\w-]+):(?:\s+(.*))?$/.exec(line);
  if (field?.[1] === undefined) {
    return false;
  }
  const value = (field[2] ?? "").trim();
  state.inBlockField = value === "";
  state.collectingResolution = state.inBlockField && field[1] === "resolution";
  if (field[1] === "resolution") {
    current.resolution = value;
  }
  return true;
}

/** Explains what is wrong with one locked package, or returns `undefined` if it is fine. */
export function lockedPackageProblem(entry: LockedPackage): string | undefined {
  const { resolution, key } = entry;
  if (resolution === undefined) {
    return `${key} has no resolution.`;
  }
  const runtime = /^node@runtime:(\d+\.\d+\.\d+)$/.exec(key);
  if (runtime?.[1] !== undefined) {
    return nodeRuntimeProblem(key, runtime[1], resolution);
  }
  if (
    /\btype:\s*(?:git|directory)\b/.test(resolution) ||
    /\b(?:repo|directory):/.test(resolution)
  ) {
    return `${key} comes from git or a local folder, not from the npm registry.`;
  }
  // pnpm leaves the URL out when it is the default for the package's
  // registry, so a mirror would look like npm. lockfileIncludeTarballUrl
  // makes pnpm always write it.
  const tarball = /\btarball:\s*([^\s,}]+)/.exec(resolution)?.[1];
  if (entry.forPackageManager === true && !/^(?:pnpm|@pnpm\/exe\.[\w-]+)@/.test(key)) {
    return `${key} is in the package-manager part of the lockfile, which may hold only pnpm.`;
  }
  // pnpm doesn't apply that setting to the part that pins pnpm itself. CI
  // still installs it from npm and checks the hash, so a mirror copy fails there.
  if (tarball === undefined && entry.forPackageManager !== true) {
    return `${key} has no tarball URL, so its registry can't be checked. Keep lockfileIncludeTarballUrl: true in pnpm-workspace.yaml and run pnpm install.`;
  }
  if (tarball !== undefined && !tarball.startsWith(npmRegistry)) {
    return `${key} comes from ${tarball}, not from the npm registry.`;
  }
  if (!/\bintegrity:\s*sha512-/.test(resolution)) {
    return `${key} has no sha512 integrity hash.`;
  }
  if (/@(?:file|link|git\+|https?):/.test(key) || /\((?:file|git)/.test(key)) {
    return `${key} is not a registry package.`;
  }
  return undefined;
}

/**
 * Finds committed settings that point a scope or the default registry
 * somewhere other than npm: `registry`/`registries:` in `pnpm-workspace.yaml`
 * and `registry=` lines in `.npmrc` (plan 3.2).
 */
export function registryOverrides(
  workspaceYaml: string,
  npmrc: string,
): { file: string; url: string }[] {
  const found: { file: string; url: string }[] = [];
  let inRegistries = false;
  for (const line of workspaceYaml.split("\n")) {
    if (/^\S/.test(line)) {
      inRegistries = /^registries:/.test(line);
      const inline = /^registry:\s*(\S+)/.exec(line)?.[1];
      if (inline !== undefined) {
        found.push({ file: "pnpm-workspace.yaml", url: inline });
      }
      continue;
    }
    const entry = /^\s+\S+:\s*(\S+)/.exec(line)?.[1];
    if (inRegistries && entry !== undefined) {
      found.push({ file: "pnpm-workspace.yaml", url: entry });
    }
  }
  for (const line of npmrc.split("\n")) {
    const value = /^\s*(?:@[^:\s]+:)?registry\s*=\s*(\S+)/.exec(line)?.[1];
    if (value !== undefined) {
      found.push({ file: ".npmrc", url: value });
    }
  }
  return found
    .map(({ file, url }) => ({ file, url: url.replace(/^["']|["']$/g, "") }))
    .filter(({ url }) => url.replace(/\/?$/, "/") !== npmRegistry);
}

/**
 * The Node version pinned by `devEngines.runtime` is locked as one binary
 * per platform. Each must come from the Node.js project's release folder
 * for that exact version (musl and RISC-V builds live on its
 * unofficial-builds host) and carry a hash.
 */
function nodeRuntimeProblem(key: string, version: string, resolution: string): string | undefined {
  const urls = [...resolution.matchAll(/^url:\s*(\S+)$/gm)].map((match) => match[1] ?? "");
  const hashes = [...resolution.matchAll(/^integrity:\s*sha(?:256|512)-\S+$/gm)];
  if (urls.length === 0 || hashes.length !== urls.length) {
    return `${key} needs a hash for every platform binary.`;
  }
  const allowedPrefixes = ["nodejs.org", "unofficial-builds.nodejs.org"].map(
    (host) => `https://${host}/download/release/v${version}/`,
  );
  if (urls.some((url) => !allowedPrefixes.some((prefix) => url.startsWith(prefix)))) {
    return `${key} downloads from somewhere other than ${allowedPrefixes.join(" or ")}.`;
  }
  return undefined;
}

/**
 * Fails on any lockfile entry without an integrity hash, from a registry
 * other than npm, or from git, a tarball URL or `file:`, on any lockfile
 * line it can't read, and on committed settings that point at another
 * registry (plan 3.2, 10.2).
 */
export function checkLockfile(context: CheckContext): Report {
  const report = new Report("lockfile");
  if (!existsSync(join(context.root, lockfile))) {
    report.error(lockfile, "The lockfile is missing. Run pnpm install and commit pnpm-lock.yaml.");
    return report;
  }
  const text = context.read(lockfile);
  if (!/^lockfileVersion: '9\.\d+'$/m.test(text)) {
    report.error(
      lockfile,
      "Unexpected lockfile version; this check reads version 9. Update the check together with pnpm.",
    );
  }
  const { entries, unreadableLines } = readLockedPackages(text);
  for (const line of unreadableLines) {
    report.error(
      lockfile,
      "This line of packages: has a shape the check can't read, so it can't be checked. Regenerate the lockfile with pnpm install (plan 3.2).",
      line,
    );
  }
  for (const entry of entries) {
    const problem = lockedPackageProblem(entry);
    if (problem !== undefined) {
      report.error(
        lockfile,
        `${problem} Only packages from registry.npmjs.org with a sha512 hash, and the pinned Node runtime, are allowed (plan 3.2).`,
        entry.line,
      );
    }
  }
  const npmrc = existsSync(join(context.root, ".npmrc")) ? context.read(".npmrc") : "";
  for (const { file, url } of registryOverrides(context.read("pnpm-workspace.yaml"), npmrc)) {
    report.error(
      file,
      `A committed setting points at the registry ${url}. Packages come from registry.npmjs.org only (plan 3.2).`,
    );
  }
  return report;
}
