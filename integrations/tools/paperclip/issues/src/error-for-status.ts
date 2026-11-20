import { PaperclipError, type PaperclipErrorCode } from "./errors.ts";
import { describeRequest } from "./paperclip-url.ts";

/**
 * Turns a Paperclip error response into a {@link PaperclipError}, by the
 * guide's status table (section 7, rule 2).
 *
 * The message names the host, the path and the status. Never Paperclip's
 * own error text, which can echo the request, nor the query string, which
 * can hold the text searched for.
 *
 * @param status - the response's HTTP status, never a `2xx`
 * @param url - the request's URL
 */
export function errorForStatus(status: number, url: string): PaperclipError {
  const code = codeForStatus(status);
  return new PaperclipError(code, `${messageFor(code, describeRequest(url))} (status ${status}).`);
}

/**
 * The error for a success response we can't use: a body that isn't JSON,
 * or one the schema refuses. The parse error and the `ZodError` can quote
 * the body, so neither is kept, not even as `cause` (rule 5).
 */
export function unexpectedResponse(url: string): PaperclipError {
  return new PaperclipError(
    "unexpected-response",
    `${messageFor("unexpected-response", describeRequest(url))}.`,
  );
}

export function codeForStatus(status: number): PaperclipErrorCode {
  switch (status) {
    case 400:
    case 422:
      return "bad-arguments";
    case 401:
      return "not-signed-in";
    case 403:
      return "not-allowed";
    case 404:
    case 410:
      return "not-found";
    case 408:
    case 429:
      return "rate-limited";
    default:
      // 5xx, and every other status the table doesn't name.
      return "unavailable";
  }
}

/** What the message says for each code, written for the user. */
function messageFor(code: PaperclipErrorCode, target: string): string {
  switch (code) {
    case "bad-arguments":
      return `Paperclip refused the request to ${target}. Check the arguments`;
    case "not-signed-in":
      return `Paperclip didn't accept the key for ${target}. Check paperclip-key`;
    case "not-allowed":
      return `The Paperclip key may not read ${target}`;
    case "not-found":
      return `Paperclip found nothing at ${target}`;
    case "rate-limited":
      return `Paperclip is busy. Try again later (${target})`;
    case "unexpected-response":
      return `Paperclip answered ${target} in an unexpected way`;
    case "bad-config":
    case "unavailable":
      return `Paperclip is having trouble with ${target}. Try again later`;
  }
}
