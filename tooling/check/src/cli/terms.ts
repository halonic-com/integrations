import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatAnnotation, type Problem } from "../lib/problems.ts";
import { readPullRequestText } from "../lib/pull-request.ts";
import {
  allowedPhrasesFile,
  loadAllowedPhrases,
  loadTerms,
  TermMatcher,
  termsEnvironmentVariable,
  termsRequiredVariable,
} from "../lib/terms.ts";
import { findRepoRoot, listRepoFiles } from "../lib/workspace.ts";

/**
 * The personal-terms guard (plan 11.1).
 *
 *   pnpm check:terms                    scan the working tree
 *   pnpm check:terms --range A..B       scan what a pull request adds: changed
 *                                       files, commit messages and authors in A..B,
 *                                       plus the branch, title and body of the
 *                                       pull request in $GITHUB_EVENT_PATH
 *   pnpm check:terms --all              scan the whole tree and the whole history
 *
 * --allowed-phrases FILE reads the harmless-phrase list from FILE instead of
 * the repo's copy. CI points it at the base commit's copy, so a pull request
 * can't weaken the guard it is checked by.
 *
 * It prints where a protected term is, never the term.
 */

const notice =
  "matches a protected term. Remove or reword it; the term itself is never shown (plan 11.1).";

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isProbablyBinary(path: string): boolean {
  const sample = readFileSync(path).subarray(0, 8000);
  return sample.includes(0);
}

function scanFiles(
  root: string,
  files: readonly string[],
  matcher: TermMatcher,
  problems: Problem[],
): void {
  for (const actualFile of files) {
    // A path that contains a term would leak it, so its matching parts are withheld.
    const file = matcher.redactPath(actualFile);
    if (file !== actualFile) {
      problems.push({ rule: "terms", severity: "error", file, message: `The file name ${notice}` });
    }
    const path = join(root, actualFile);
    if (!existsSync(path) || isProbablyBinary(path)) {
      continue;
    }
    for (const line of matcher.matchingLines(readFileSync(path, "utf8"))) {
      problems.push({
        rule: "terms",
        severity: "error",
        file,
        line,
        message: `This line ${notice}`,
      });
    }
  }
}

function scanCommits(
  root: string,
  revisions: readonly string[],
  matcher: TermMatcher,
  problems: Problem[],
): void {
  const separator = "\u001e";
  const log = git(root, ["log", `--format=%H%n%an <%ae>%n%cn <%ce>%n%B${separator}`, ...revisions]);
  for (const entry of log.split(separator)) {
    const [hash = "", author = "", committer = "", ...message] = entry.trim().split("\n");
    if (hash === "") {
      continue;
    }
    const short = hash.slice(0, 10);
    if (matcher.matches(author) || matcher.matches(committer)) {
      problems.push({
        rule: "terms",
        severity: "error",
        file: `commit ${short}`,
        message: `The author or committer ${notice}`,
      });
    }
    if (matcher.matches(message.join("\n"))) {
      problems.push({
        rule: "terms",
        severity: "error",
        file: `commit ${short}`,
        message: `The commit message ${notice}`,
      });
    }
  }
}

/**
 * The pull request text comes from the event file, not from `env:`, because
 * GitHub prints a step's `env:` block in the public job log.
 */
function scanPullRequest(matcher: TermMatcher, problems: Problem[]): void {
  const pullRequest = readPullRequestText();
  const fields: [string, string | undefined][] = [
    ["branch name", pullRequest?.branch],
    ["pull request title", pullRequest?.title],
    ["pull request body", pullRequest?.body],
  ];
  for (const [label, value] of fields) {
    if (value !== undefined && matcher.matches(value)) {
      problems.push({
        rule: "terms",
        severity: "error",
        file: label,
        message: `The ${label} ${notice}`,
      });
    }
  }
}

/**
 * Asks GitHub to hide every term in the job log. The secret is masked as a
 * whole, but not the single entries of a multi-line list.
 */
function maskTerms(terms: readonly string[]): void {
  for (const term of terms) {
    console.log(`::add-mask::${term.replace(/%/g, "%25")}`);
  }
}

function main(argv: readonly string[]): number {
  const root = findRepoRoot();
  const { terms, source } = loadTerms();
  if (process.env["GITHUB_ACTIONS"]) {
    maskTerms(terms);
  }
  const phrasesIndex = argv.indexOf("--allowed-phrases");
  const phrasesFile =
    phrasesIndex === -1 ? join(root, allowedPhrasesFile) : (argv[phrasesIndex + 1] ?? "");
  let matcher: TermMatcher;
  try {
    matcher = new TermMatcher(terms, loadAllowedPhrases(phrasesFile));
  } catch (error) {
    // Only the phrase list can fail here, and the message names an entry by
    // number, never by text, so it is safe to print.
    console.error(`terms: FAILED. ${error instanceof Error ? error.message : "Bad phrase list."}`);
    return 1;
  }
  if (matcher.isEmpty && source !== "nowhere") {
    // A list that is set but holds nothing usable is a broken secret, not a
    // missing one: failing is the only way anyone notices.
    console.error(
      `terms: FAILED. ${source} is set but holds no usable term, so nothing was scanned.`,
    );
    return 1;
  }
  if (matcher.isEmpty && process.env[termsRequiredVariable] === "true") {
    console.error(
      `terms: FAILED. ${termsRequiredVariable} is true but the ${termsEnvironmentVariable} secret is not available, so nothing was scanned.`,
    );
    return 1;
  }
  if (matcher.isEmpty) {
    // Until the secret exists the guard skips loudly instead of failing, so
    // work can start; the notice shows on every run (plan 11.1, 16.4).
    const message = `terms: SKIPPED. The ${termsEnvironmentVariable} Actions secret is not set yet, so nothing was scanned. Set it on the halonic-com organisation to turn the guard on (plan 11.1).`;
    console.log(process.env["GITHUB_ACTIONS"] ? `::warning title=terms::${message}` : message);
    return 0;
  }
  const problems: Problem[] = [];
  const rangeIndex = argv.indexOf("--range");
  if (argv.includes("--all")) {
    scanFiles(root, listRepoFiles(root), matcher, problems);
    scanCommits(root, ["--all"], matcher, problems);
  } else if (rangeIndex !== -1) {
    const range = argv[rangeIndex + 1] ?? "";
    if (!/^[\w./-]+\.\.[\w./-]+$/.test(range)) {
      console.error(`--range needs BASE..HEAD, got "${range}".`);
      return 2;
    }
    const changed = git(root, [
      "diff",
      "--name-only",
      "--diff-filter=d",
      "-z",
      range.replace("..", "..."),
    ]);
    scanFiles(
      root,
      changed.split("\0").filter((file) => file !== ""),
      matcher,
      problems,
    );
    scanCommits(root, [range], matcher, problems);
    scanPullRequest(matcher, problems);
  } else {
    scanFiles(root, listRepoFiles(root), matcher, problems);
  }
  for (const problem of problems) {
    const location = problem.line === undefined ? problem.file : `${problem.file}:${problem.line}`;
    console.log(
      process.env["GITHUB_ACTIONS"] ? formatAnnotation(problem) : `${location}: ${problem.message}`,
    );
  }
  console.log(
    `terms: ${problems.length === 0 ? "clean" : `${problems.length} finding(s)`} (list from ${source}).`,
  );
  return problems.length === 0 ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch {
  // An error can carry git output (commit messages) or the terms, so none of it is printed.
  console.error(
    "terms: the guard failed before it finished. Run it locally to see why; no details are printed here (plan 11.1).",
  );
  process.exitCode = 2;
}
