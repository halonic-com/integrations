import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readAdvisories } from "../lib/advisories.ts";
import { findRepoRoot } from "../lib/workspace.ts";

/**
 * pnpm check:audit [pnpm audit options]
 *
 * Runs `pnpm audit` and passes it every advisory in
 * `tooling/check/advisories-ignored.json` as an `--ignore`. That file is the
 * only place an advisory is ignored. An invalid or expired entry stops the
 * run before the audit starts.
 */
function main(): number {
  const root = findRepoRoot();
  const path = "tooling/check/advisories-ignored.json";
  const { entries, problems } = readAdvisories(readFileSync(join(root, path), "utf8"), new Date());
  if (problems.length > 0) {
    const annotate = process.env["GITHUB_ACTIONS"] === "true";
    for (const problem of problems) {
      console.log(
        annotate
          ? `::error file=${path},title=advisories::${problem}`
          : `error [advisories] ${path}: ${problem}`,
      );
    }
    return 1;
  }
  const ignores = entries.flatMap((entry) => ["--ignore", entry.ghsa]);
  console.log(`audit: ${entries.length} advisory(ies) ignored by ${path}.`);
  const result = spawnSync("pnpm", ["audit", ...process.argv.slice(2), ...ignores], {
    cwd: root,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

process.exitCode = main();
