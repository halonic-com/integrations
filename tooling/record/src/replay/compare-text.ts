import { USER_CONTENT } from "../scrub/fakes.ts";

/**
 * Two texts match when they are equal apart from the numbers in stand-ins.
 * The recorder numbered stand-ins over requests and responses with the
 * service's own values; a replay only sees the requests, so its numbers can
 * run differently.
 */
export function sameText(recorded: string | undefined, sent: string | undefined): boolean {
  if (recorded === undefined || sent === undefined) {
    return recorded === sent;
  }
  return withoutStandInNumbers(recorded) === withoutStandInNumbers(sent);
}

function withoutStandInNumbers(text: string): string {
  return (
    text
      .replace(/scrubbed-secret-\d+/g, "scrubbed-secret-n")
      // In a URL, the `@` and `+` are percent-encoded.
      .replace(/person\d+(@|%40)example\.com/gi, "person-n$1example.com")
      .replace(/(\+|%2B)447700900\d{3}/gi, "$1447700900nnn")
  );
}

export function shown(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

/**
 * A hint when the recording has user content where the request has
 * something else. In a URL's query the placeholder is percent-encoded.
 */
export function userContentHint(recorded: unknown, sent: unknown): string {
  const placeholder =
    typeof recorded === "string" &&
    (recorded.includes(USER_CONTENT.text) ||
      recorded.includes(encodeURIComponent(USER_CONTENT.text)));
  if (!placeholder || sent === undefined) {
    return "";
  }
  return " If it is the user's own content, pass the integration's recording policy to replay.";
}
