/**
 * Hand-written Google answers whose `status` isn't a string, in the shape
 * Google sends: https://cloud.google.com/apis/design/errors#http_mapping
 *
 * The odd `status` holds free text that quotes the user's content, as
 * Google's `message` can, so tests can check that none of it reaches a
 * message.
 */

/** The free text in each answer, which must never reach a message. */
export const userContentInOddStatus = /alex@example\.com|Holiday plans/;

/** A rate limit whose `status` is an object holding free text instead of a name. */
export function oddStatusRateLimitBody(): string {
  return JSON.stringify({
    error: {
      code: 403,
      message: "Holiday plans for alex@example.com",
      errors: [
        {
          domain: "usageLimits",
          reason: "rateLimitExceeded",
          message: "Holiday plans for alex@example.com",
        },
      ],
      status: { message: "Holiday plans for alex@example.com" },
    },
  });
}

/** The same odd `status`, with no `errors` list to fall back on. */
export function oddStatusOnlyBody(): string {
  return JSON.stringify({
    error: {
      code: 503,
      message: "Holiday plans for alex@example.com",
      status: ["Holiday plans for alex@example.com"],
    },
  });
}
