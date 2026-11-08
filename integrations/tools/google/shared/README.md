# Google shared library

`@halonicjs/integration-tool-google-shared` holds the code that every
Google integration needs, so Gmail and Drive don't repeat it. It is a
library, not an integration: it has no permission sheet, no tools and no
`Integration` ([guide, section 2](../../../../docs/guides/integrations.md#2-where-it-goes-and-what-its-called)).

| File                        | What it does                                                  |
| --------------------------- | ------------------------------------------------------------- |
| `src/errors.ts`             | `GoogleError`, the one error type of every Google integration |
| `src/error-for-response.ts` | turns a Google error response into a `GoogleError`            |
| `src/error-reason.ts`       | reads Google's machine-readable reason, never its free text   |
| `src/http.ts`               | the small part of the kit's HTTP client this library uses     |

## Errors

Every Google error becomes a `GoogleError` with one of the guide's codes
([section 7](../../../../docs/guides/integrations.md#7-errors)):

| Status                                                                        | `code`                |
| ----------------------------------------------------------------------------- | --------------------- |
| `400`, `422`                                                                  | `bad-arguments`       |
| `401`                                                                         | `not-signed-in`       |
| `403`                                                                         | `not-allowed`         |
| `403` with a rate-limit reason (`rateLimitExceeded`, `userRateLimitExceeded`) | `rate-limited`        |
| `403` with a limit reason (`dailyLimitExceeded`, `quotaExceeded`)             | `quota-exceeded`      |
| `404`                                                                         | `not-found`           |
| `408`, `429`                                                                  | `rate-limited`        |
| `5xx` and any other status                                                    | `unavailable`         |
| a body that isn't JSON or that the schema refuses                             | `unexpected-response` |

The message names the service, the host and path (never the query), the
status, and Google's reason when it looks like an identifier. It never
holds Google's own error text: that text can echo the request, including
the user's content.

## Keys

The library never sees a key or token. The Google sign-in and the token
refresh belong to Halonic. A request only names the secret
(`google-account`), and the kit adds the access token.
