import { readFileSync } from "node:fs";

/** The text of the pull request a GitHub Actions run is for. */
export interface PullRequestText {
  readonly branch: string;
  readonly title: string;
  readonly body: string;
}

/**
 * Reads the pull request from the event JSON at `$GITHUB_EVENT_PATH`. We
 * never pass this text through `env:`, because GitHub prints a step's
 * `env:` block in the public job log (plan 11.1).
 *
 * @returns `undefined` outside Actions, or when the event isn't a pull request
 */
export function readPullRequestText(
  eventPath: string | undefined = process.env["GITHUB_EVENT_PATH"],
): PullRequestText | undefined {
  if (eventPath === undefined || eventPath === "") {
    return undefined;
  }
  const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
    pull_request?: { title?: string; body?: string | null; head?: { ref?: string } };
  };
  const pullRequest = event.pull_request;
  if (pullRequest === undefined) {
    return undefined;
  }
  return {
    branch: pullRequest.head?.ref ?? "",
    title: pullRequest.title ?? "",
    body: pullRequest.body ?? "",
  };
}
