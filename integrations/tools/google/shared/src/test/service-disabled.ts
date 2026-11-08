/**
 * Hand-written Google answers for a switched-off API, in the shape Google
 * sends: https://cloud.google.com/apis/design/errors#error_info
 *
 * The project number is made up. The free text quotes the user's content,
 * as Google's can, so tests can check that none of it reaches a message.
 */

const fakeProjectNumber = "123456789012";

/** The free text in each answer, which must never reach a message. */
export const userContentInFreeText = /alex@example\.com|Holiday plans|activationUrl|overview/;

/** Google's full answer: the older `accessNotConfigured` and the newer `ErrorInfo`. */
export function serviceDisabledBody(api = "drive.googleapis.com"): string {
  const activationUrl = `https://console.developers.google.com/apis/api/${api}/overview?project=${fakeProjectNumber}`;
  return JSON.stringify({
    error: {
      code: 403,
      message: `The API has not been used in project ${fakeProjectNumber} before or it is disabled. Holiday plans for alex@example.com`,
      errors: [
        {
          message: "Holiday plans for alex@example.com",
          domain: "usageLimits",
          reason: "accessNotConfigured",
          extendedHelp: "https://console.developers.google.com",
        },
      ],
      status: "PERMISSION_DENIED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "SERVICE_DISABLED",
          domain: "googleapis.com",
          metadata: {
            service: api,
            consumer: `projects/${fakeProjectNumber}`,
            containerInfo: fakeProjectNumber,
            activationUrl,
            serviceTitle: "Holiday plans for alex@example.com",
          },
        },
        {
          "@type": "type.googleapis.com/google.rpc.LocalizedMessage",
          locale: "en-US",
          message: "Holiday plans for alex@example.com",
        },
        {
          "@type": "type.googleapis.com/google.rpc.Help",
          links: [{ description: "activationUrl", url: activationUrl }],
        },
      ],
    },
  });
}

/** Only the newer `ErrorInfo`, with no `errors` list, as some newer APIs answer. */
export function errorInfoOnlyBody(metadata: Record<string, unknown>): string {
  return JSON.stringify({
    error: {
      code: 403,
      message: "Holiday plans for alex@example.com",
      status: "PERMISSION_DENIED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "SERVICE_DISABLED",
          domain: "googleapis.com",
          metadata,
        },
      ],
    },
  });
}

/**
 * The full answer as a recording keeps it: the recorder replaces every
 * free-text field, the whole `ErrorInfo` metadata included
 * (`tooling/record/src/scrub/service-errors.ts`).
 */
export function recordedServiceDisabledBody(): string {
  const scrubbed = "<scrubbed:content>";
  return JSON.stringify({
    error: {
      code: 403,
      message: scrubbed,
      errors: [
        {
          message: scrubbed,
          domain: "usageLimits",
          reason: "accessNotConfigured",
          extendedHelp: "https://console.developers.google.com",
        },
      ],
      status: "PERMISSION_DENIED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "SERVICE_DISABLED",
          domain: "googleapis.com",
          metadata: { "field-1": scrubbed, "field-2": scrubbed },
        },
        { "@type": "type.googleapis.com/google.rpc.LocalizedMessage", message: scrubbed },
      ],
    },
  });
}
