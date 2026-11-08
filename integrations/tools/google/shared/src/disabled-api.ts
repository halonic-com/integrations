import { z } from "zod";
import { errorEntriesSchema, parseJsonOrUndefined } from "./error-reason.ts";

/**
 * Reads whether a Google `403` means the API is switched off in the user's
 * Google Cloud project, and if so which API and which project.
 *
 * Google says so in two places. The older `errors[*].reason` is
 * `accessNotConfigured`; the newer `details` hold an `ErrorInfo` whose
 * `reason` is `SERVICE_DISABLED` and whose `metadata` names the API and the
 * project: https://cloud.google.com/apis/design/errors#error_info
 *
 * ```json
 * { "error": { "code": 403, "status": "PERMISSION_DENIED", "message": "…",
 *     "errors": [{ "domain": "usageLimits", "reason": "accessNotConfigured", "message": "…" }],
 *     "details": [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo",
 *       "reason": "SERVICE_DISABLED", "domain": "googleapis.com",
 *       "metadata": { "service": "drive.googleapis.com", "consumer": "projects/123456789012" } }] } }
 * ```
 *
 * Only `service` and `consumer` are read from `metadata`, and only when
 * they have the shape of an API name and a project. The other metadata,
 * such as `activationUrl`, and every `message` are ignored.
 */

/** The API that is switched off. A part is `undefined` when Google didn't name it in a shape we trust. */
export interface DisabledApi {
  /** The API's service name, such as `drive.googleapis.com`. */
  readonly api: string | undefined;
  /** The Google Cloud project, as Google names it in the error: usually its number. */
  readonly project: string | undefined;
}

const errorInfoType = "type.googleapis.com/google.rpc.ErrorInfo";

/**
 * Only the fields we read. Each `errors` entry and each detail is read on
 * its own: one we can't read, or a detail of another type, is skipped, so
 * the others still count.
 */
const errorBodySchema = z.object({
  error: z.object({
    errors: errorEntriesSchema,
    details: z.array(z.unknown()).optional().catch(undefined),
  }),
});

/**
 * An odd `metadata` reads as missing instead of refusing the `ErrorInfo`,
 * so the API still counts as switched off when Google names it oddly.
 */
const errorInfoSchema = z.object({
  "@type": z.literal(errorInfoType),
  reason: z.string().optional(),
  metadata: z
    .object({
      service: z.string().optional().catch(undefined),
      consumer: z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

/** A Google API's service name: lower-case labels ending in `.googleapis.com`. */
const apiPattern = /^(?:[a-z][a-z0-9-]{0,62}\.)+googleapis\.com$/;

/** `projects/` and a project number or id, which are lower-case letters, digits and hyphens. */
const consumerPattern = /^projects\/([a-z0-9][a-z0-9-]{0,62})$/;

/**
 * The switched-off API, or `undefined` when the body doesn't say the API
 * is switched off, isn't JSON, or isn't in Google's format.
 *
 * @param bodyText - the body of a `403` response as text; it may be anything
 */
export function disabledApiIn(bodyText: string): DisabledApi | undefined {
  const parsed = errorBodySchema.safeParse(parseJsonOrUndefined(bodyText));
  if (!parsed.success) {
    return undefined;
  }
  const { errors, details } = parsed.data.error;
  const errorInfo = serviceDisabledInfo(details ?? []);
  const saysAccessNotConfigured = (errors ?? []).some(
    (error) => error.reason === "accessNotConfigured",
  );
  if (errorInfo === undefined && !saysAccessNotConfigured) {
    return undefined;
  }
  return {
    api: apiOf(errorInfo?.metadata?.service),
    project: projectOf(errorInfo?.metadata?.consumer),
  };
}

type ErrorInfo = z.infer<typeof errorInfoSchema>;

/** The first `ErrorInfo` detail with the reason `SERVICE_DISABLED`. */
function serviceDisabledInfo(details: readonly unknown[]): ErrorInfo | undefined {
  for (const detail of details) {
    const parsed = errorInfoSchema.safeParse(detail);
    if (parsed.success && parsed.data.reason === "SERVICE_DISABLED") {
      return parsed.data;
    }
  }
  return undefined;
}

/** The API from a `service` such as `drive.googleapis.com`. */
function apiOf(service: string | undefined): string | undefined {
  return service !== undefined && apiPattern.test(service) ? service : undefined;
}

/** The project from a `consumer` such as `projects/123456789012`. */
function projectOf(consumer: string | undefined): string | undefined {
  return consumer === undefined ? undefined : consumerPattern.exec(consumer)?.[1];
}
