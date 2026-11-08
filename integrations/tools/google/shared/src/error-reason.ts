import { z } from "zod";

/**
 * Reads Google's machine-readable reason from an error body, such as
 * `rateLimitExceeded` or `notFound`. Never its free text: `message` can echo
 * the request, including the user's content.
 *
 * Gmail and Drive answer errors in Google's JSON API format:
 * https://cloud.google.com/apis/design/errors#http_mapping
 *
 * ```json
 * { "error": { "code": 403, "message": "…", "status": "PERMISSION_DENIED",
 *     "errors": [{ "domain": "usageLimits", "reason": "rateLimitExceeded", "message": "…" }] } }
 * ```
 */

/**
 * One entry of Google's older `errors` list, of which only `reason` is read.
 * An entry we can't read, such as one whose `reason` isn't a string, reads
 * as having no reason, so it doesn't make us refuse the whole body.
 */
const errorEntrySchema = z.object({ reason: z.string().optional() }).catch({ reason: undefined });

/**
 * Google's older `errors` list, read entry by entry. A list that isn't a
 * list reads as missing.
 */
export const errorEntriesSchema = z.array(errorEntrySchema).optional().catch(undefined);

/**
 * Only the fields we read. Every other field, `message` included, is ignored.
 * A `status` that isn't a string reads as missing, like an odd `errors`
 * entry, so it doesn't cost us the reason in `errors`.
 */
const errorBodySchema = z.object({
  error: z.object({
    status: z.string().optional().catch(undefined),
    errors: errorEntriesSchema,
  }),
});

/** A reason we repeat must look like an identifier (guide, section 7, rule 3). */
const reasonPattern = /^[a-z][a-z0-9_.-]{0,63}$/i;

/**
 * The reason Google gives for an error, or `undefined` when the body has
 * none, isn't JSON, or holds something that doesn't look like a reason.
 *
 * Prefers the older `errors[0].reason` (`rateLimitExceeded`), which tells
 * more than `status` (`PERMISSION_DENIED`) does.
 */
export function googleErrorReason(bodyText: string): string | undefined {
  const parsed = errorBodySchema.safeParse(parseJsonOrUndefined(bodyText));
  if (!parsed.success) {
    return undefined;
  }
  const { errors, status } = parsed.data.error;
  const reason = errors?.[0]?.reason ?? status;
  return reason !== undefined && reasonPattern.test(reason) ? reason : undefined;
}

/** The parsed body, or `undefined` for a body that isn't JSON. The parse error quotes the body, so it never escapes. */
export function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
