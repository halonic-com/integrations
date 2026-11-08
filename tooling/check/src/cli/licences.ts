import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findLicenceProblems, type InstalledPackage, type LicencePolicy } from "../lib/licences.ts";
import { findRepoRoot, readJson } from "../lib/workspace.ts";

/**
 * pnpm check:licences
 *
 * Compares every installed package's licence with the allow-lists in
 * `tooling/check/licences.json` (plan 11): production dependencies against
 * the shipped list, everything else against the wider dev-tooling list.
 */

interface LicenceEntry {
  readonly name: string;
  readonly versions: readonly string[];
}

function listInstalled(root: string, production: boolean): InstalledPackage[] {
  const args = ["--recursive", "licenses", "list", "--json", ...(production ? ["--prod"] : [])];
  const output = execFileSync("pnpm", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const byLicence = JSON.parse(output.trim() === "" ? "{}" : output) as Record<
    string,
    LicenceEntry[]
  >;
  return Object.entries(byLicence).flatMap(([licence, entries]) =>
    entries.map((entry) => ({ name: entry.name, versions: entry.versions, licence })),
  );
}

function main(): number {
  const root = findRepoRoot();
  const policy = readJson<LicencePolicy>(join(root, "tooling/check/licences.json"));
  const shipped = listInstalled(root, true);
  const shippedNames = new Set(shipped.map((pkg) => pkg.name));
  const devOnly = listInstalled(root, false).filter((pkg) => !shippedNames.has(pkg.name));
  const problems = [
    ...findLicenceProblems(shipped, policy, "shipped"),
    ...findLicenceProblems(devOnly, policy, "dev"),
  ];
  const annotate = process.env["GITHUB_ACTIONS"] === "true";
  for (const problem of problems) {
    console.log(annotate ? `::error title=licences::${problem}` : `error [licences] ${problem}`);
  }
  console.log(
    `licences: ${problems.length} problem(s) in ${shipped.length} shipped and ${devOnly.length} dev-only packages.`,
  );
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = main();
