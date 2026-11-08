import type { CheckContext } from "../lib/context.ts";
import { Report } from "../lib/problems.ts";
import { isTestFile } from "../lib/source-files.ts";

const checked = /\.(?:[cm]?[jt]sx?|md|mdx|json|jsonc|ya?ml|toml|astro|css|html)$/;

/**
 * Paths that only exist on one person's or one agent's machine. Built from
 * parts so this file doesn't trip its own check.
 */
const machinePaths: readonly RegExp[] = [
  new RegExp(String.raw`(?<![\w.])[A-Za-z]:(?:\\{1,2}|/)(?:Users|Documents and Settings)\b`, "i"),
  new RegExp(`(?<![\\w.~])/(?:${["home", "Users", "root"].join("|")})/[\\w.-]+`),
  new RegExp(`(?<![\\w.])/(?:${["mnt/[a-z]", "paperclip", "tmp/paperclip"].join("|")})/`),
  new RegExp(String.raw`\\\\wsl(?:\$|\.localhost)\\`, "i"),
];

/** Test files and fixtures may hold such paths on purpose, for example in attack tests. */
function isExempt(file: string): boolean {
  return isTestFile(file) || /(?:^|\/)(?:fixtures|__fixtures__|golden)\//.test(file);
}

/**
 * Fails on absolute local paths (such as a Windows user folder or a Linux
 * home folder) in docs, code and config. They leak who wrote the file and
 * where, and they never work on another machine (plan 10.2, 11).
 */
export function checkAbsolutePaths(context: CheckContext): Report {
  const report = new Report("absolute-paths");
  for (const file of context.files) {
    if (!checked.test(file) || isExempt(file)) {
      continue;
    }
    context
      .read(file)
      .split("\n")
      .forEach((text, index) => {
        if (machinePaths.some((pattern) => pattern.test(text))) {
          report.error(
            file,
            "This line holds an absolute path from one machine. Use a path relative to the repo root, or a placeholder such as <workspace> or ~/.config/halonic (plan 10.2).",
            index + 1,
          );
        }
      });
  }
  return report;
}
