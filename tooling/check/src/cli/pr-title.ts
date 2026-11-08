import { readPullRequestText } from "../lib/pull-request.ts";

/**
 * Checks the pull request title against Conventional Commits, because
 * squash merges use it as the commit message (plan 10.2). In CI the title
 * comes from the event file; locally, set PR_TITLE.
 */

const types = ["feat", "fix", "docs", "refactor", "perf", "test", "build", "ci", "chore", "revert"];
const pattern = new RegExp(`^(?:${types.join("|")})(?:\\([a-z0-9][a-z0-9-]*\\))?!?: \\S.{0,99}$`);

/** True when the title is `type(scope): summary` with a known type. */
export function isConventionalTitle(title: string): boolean {
  return pattern.test(title);
}

if (import.meta.main) {
  const title = readPullRequestText()?.title ?? process.env["PR_TITLE"] ?? "";
  if (isConventionalTitle(title)) {
    console.log("pr-title: ok.");
  } else {
    console.error(
      `pr-title: use "type(scope): summary" with a type from ${types.join(", ")}, at most 100 characters. Example: "feat(check): fail on deep imports".`,
    );
    process.exitCode = 1;
  }
}
