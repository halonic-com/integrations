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
| `src/google-api.ts`         | `googleApi`: every Google request goes through it             |
| `src/retry-policy.ts`       | when a request is sent again, and how long to wait first      |
| `src/urls.ts`               | Google base URLs, URL building and paging                     |

## Requests

```ts
const google = googleApi(host, { secret: "google-account", service: "Gmail", clock });
const url = googleUrl(googleBaseUrls.gmail, ["users", "me", "messages"], { q: query, pageToken });
const page = await google.getJson(url, withNextPageToken(messageListSchema), signal);
```

`getJson`, `getText`, `postJson` and `delete` cover most calls; `send`
takes any method. Each call sends at most three requests.

## Retries

As the guide's rule 10 says
([section 4](../../../../docs/guides/integrations.md#4-talking-to-the-service)):

- at most two retries, only after a `429` or a `5xx`. A `403` with a
  rate-limit reason becomes `rate-limited` but isn't retried;
- after the wait `retry-after` asks for, up to 30 seconds. A longer one
  ends the call with `rate-limited`. Without `retry-after`: 1 s, then 2 s;
- only for `GET` and `HEAD`, or a request the caller marks `repeatable`
  because Google makes it safe to repeat. `postJson` is never retried, and
  a `DELETE` never is, even when marked;
- only with a `clock`. It gives the time and does the waiting, so tests and
  replays control time. Without one, nothing is retried.

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
search term. The recorder only scrubs the fields a sheet declares
([guide, section 9](../../../../docs/guides/integrations.md#9-tests-and-recordings)),
so every Google integration lists these paths under
`recording.userContent` in its `integration.yaml`:

```yaml
recording:
  userContent:
    # Google's error text can repeat what was sent, such as a recipient
    - response.body.error.message
    - response.body.error.errors[*].message
    # error.details can echo the request too (a field's description, metadata)
    - response.body.error.details
```

| Path                      | Why                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `error.message`           | Google's sentence about the error, which can quote a value from the request                                                          |
| `error.errors[*].message` | the same sentence in the older format, once per error                                                                                |
| `error.details`           | the newer format's list: a `BadRequest` describes each refused field in words, and an `ErrorInfo` carries metadata about the request |

The library reads only `error.status` and `error.errors[*].reason`, and
none of these paths covers them, so a replay maps an error to the same code.
`error.code`, `error.status` and `error.errors[*].domain` stay readable in
the file.

A scenario without an error matches none of these paths, so it lists all
three in its `unusedUserContent`.

## Keys

The library never sees a key or token. The Google sign-in and the token
refresh belong to Halonic. A request only names the secret
(`google-account`), and the kit adds the access token.
