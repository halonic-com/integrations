# Google shared library

`@halonicjs/integration-tool-google-shared` holds the code that every
Google integration needs, so Gmail and Drive don't repeat it. It is a
library, not an integration: it has no permission sheet, no tools and no
`Integration` ([guide, section 2](../../../../docs/guides/integrations.md#2-where-it-goes-and-what-its-called)).

| File                        | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `src/errors.ts`             | `GoogleError`, the one error type of every Google integration      |
| `src/error-for-response.ts` | turns a Google error response into a `GoogleError`                 |
| `src/error-reason.ts`       | reads Google's machine-readable reason, never its free text        |
| `src/http.ts`               | the small part of the kit's host this library uses: `http`, `wait` |
| `src/google-api.ts`         | `googleApi`: every Google request goes through it                  |
| `src/retry-policy.ts`       | when a request is sent again, and how long to wait first           |
| `src/urls.ts`               | Google base URLs, URL building and paging                          |

## Requests

```ts
const google = googleApi(host, { secret: "google-account", service: "Gmail" });
const url = googleUrl(googleBaseUrls.gmail, ["users", "me", "messages"], { q: query, pageToken });
const page = await google.getJson(url, withNextPageToken(messageListSchema), signal);
```

`getJson`, `getText`, `postJson` and `delete` cover most calls. `sendJson`
takes any request and reads its JSON answer, such as a `PATCH` or Drive's
multipart upload; `send` takes any request and returns the response. Each
call sends at most three requests.

## Retries

As the guide's rule 10 says
([section 4](../../../../docs/guides/integrations.md#4-talking-to-the-service)):

- at most two retries, only after a `429` or a `5xx`. A `403` with a
  rate-limit reason becomes `rate-limited` but isn't retried;
- after the wait `retry-after` asks for, up to 30 seconds (the host's
  `maxIntegrationWaitMs`). A longer one ends the call with `rate-limited`.
  A date is measured against the response's own `date` header, so no clock
  is needed. Without a `retry-after` it can use: 1 s, then 2 s;
- only for `GET` and `HEAD`, or a request the caller marks `repeatable`
  because Google makes it safe to repeat. `postJson` is never retried, and
  a `DELETE` never is, even when marked;
- waiting with `host.wait` and the call's own `signal`, so cancelling the
  call also ends the pause. Tests pass a `wait` that records the pause
  instead of waiting.

The kit's own errors, such as a refused host or a timeout, pass through
unchanged and are never retried.

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

## Recordings

Google's error text can repeat what was sent: a recipient, a file name, a
search term. The recorder removes it by itself for every response from a
`*.googleapis.com` host whose `error` is an object
([recorder README](../../../../tooling/record/README.md#what-is-always-removed)),
so a Google sheet doesn't list these paths under `recording.userContent`:

| Path                                    | Why                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `error.message`                         | Google's sentence about the error, which can quote a value from the request                                 |
| `error.errors[*].message`               | the same sentence in the older format, once per error                                                       |
| the free-text fields of `error.details` | a `BadRequest` describes each refused field in words, and an `ErrorInfo` carries metadata about the request |

The library reads only `error.status` and `error.errors[*].reason`, and
none of these paths covers them, so a replay maps an error to the same code.
`error.code`, `error.status`, `error.errors[*].domain` and each detail's
`@type`, `reason`, `domain` and `retryDelay` stay readable in the file.

OAuth errors from `oauth2.googleapis.com`, where `error` is a code such as
`invalid_grant`, are left alone. A sheet can't opt out of these paths yet.

## Keys

The library never sees a key or token. The Google sign-in and the token
refresh belong to Halonic. A request only names the secret
(`google-account`), and the kit adds the access token.
