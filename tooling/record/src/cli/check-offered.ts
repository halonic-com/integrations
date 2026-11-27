// pnpm check:offered
// Scans the integrations offered from Halonic Studio (integrations/offered/)
// as text: it never imports, builds or runs them. It checks the repo it is
// run in, so CI can run the base commit's copy on a pull request's files.

import { execFileSync } from "node:child_process";
import { checkOffers, offeredFolder } from "../offered/check-offered.ts";

function main(): number {
  const git = (args: readonly string[], cwd?: string) =>
    execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  const files = git(
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", offeredFolder],
    root,
  )
    .split("\0")
    .filter((file) => file !== "");
  const problems = checkOffers(root, files);
  for (const problem of problems) {
    console.log(`${problem.file}: ${problem.message}`);
  }
  console.log(`check:offered: ${problems.length} problem(s) in ${files.length} offered file(s).`);
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = main();
