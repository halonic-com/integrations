import { readAdvisories } from "../lib/advisories.ts";
import type { CheckContext } from "../lib/context.ts";
import { Report } from "../lib/problems.ts";

const guide = "See docs/guides/checks.md.";
export const advisoriesPath = "tooling/check/advisories-ignored.json";

/** pnpm settings that ignore an advisory; only `advisories-ignored.json` may. */
const ignoreSettings = /\b(?:auditConfig|ignoreGhsas|ignoreCves|ignoreUnfixable)\b/;
/**
 * An ignore flag on an audit command, in a workflow or a script. Not
 * `--ignore-workspace`, which is a pnpm option and ignores no advisory.
 */
const ignoreFlag = /\baudit\b.*--ignore(?!-workspace)/;

/**
 * Advisories are ignored in exactly one file, with a reason and an expiry
 * date of at most 90 days. Fails on an invalid or expired entry, and on any
 * other way to ignore one: a pnpm setting or an `--ignore` flag.
 */
export function checkAdvisories(context: CheckContext, today = new Date()): Report {
  const report = new Report("advisories");
  if (!context.files.includes(advisoriesPath)) {
    report.error(
      advisoriesPath,
      `The file is missing. Keep it, with an empty list when nothing is ignored. ${guide}`,
    );
  } else {
    for (const problem of readAdvisories(context.read(advisoriesPath), today).problems) {
      report.error(advisoriesPath, `${problem}. ${guide}`);
    }
  }
  for (const file of context.files) {
    const settingsFile =
      file === "pnpm-workspace.yaml" || file === "package.json" || file.endsWith("/package.json");
    if (!settingsFile && !file.startsWith(".github/")) {
      continue;
    }
    context
      .read(file)
      .split("\n")
      .forEach((text, index) => {
        if (ignoreFlag.test(text) || (settingsFile && ignoreSettings.test(text))) {
          report.error(
            file,
            `Advisories are ignored only in ${advisoriesPath}, which "pnpm check:audit" passes to pnpm. Remove this. ${guide}`,
            index + 1,
          );
        }
      });
  }
  return report;
}
