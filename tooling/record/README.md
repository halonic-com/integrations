# tooling/record

`pnpm record <integration>` records an integration's real HTTP traffic so
the conformance suite can replay it. Both repos are public, so nothing is
saved until the scrubber has removed keys, tokens, e-mail addresses, phone
numbers and the user's own content.

`src/scrub` has no repo-specific imports and no I/O, so it can move into the
shared kit for "Offer to Halonic" (I6) unchanged.

## What is always removed

| What                                                                                                                                                    | How                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `authorization`, `proxy-authorization`, `x-api-key`, `api-key`, `x-auth-token`                                                                          | Value becomes `scrubbed-secret-<n>`; a scheme such as `Bearer ` is kept           |
| `cookie`, `set-cookie`                                                                                                                                  | Value becomes `scrubbed`                                                          |
| A user name or password in a URL                                                                                                                        | Becomes `scrubbed`                                                                |
| Query parameters and form fields named like a secret (`key`, `api_key`, `access_token`, `token`, `sig`, `code`, `*token*`, `*secret*`, `password`, ...) | Value becomes `scrubbed-secret-<n>`                                               |
| JSON fields named like a secret, when the value is a string                                                                                             | Value becomes `scrubbed-secret-<n>`. Numbers stay, so `max_tokens: 1024` survives |
| The key values the kit added during the recording, anywhere, including URL-encoded, base64-encoded or split into pieces                                 | `scrubbed-secret-<n>`                                                             |
| Token-shaped values anywhere (JWTs, `sk-...`, `ghp_...`, `AIza...`, `ya29....`, `xox?-...`, AWS key IDs, ...)                                           | `scrubbed-secret-<n>`                                                             |
| Long random-looking values anywhere                                                                                                                     | `scrubbed-secret-<n>`                                                             |
| E-mail addresses anywhere                                                                                                                               | `person-<n>@example.com`                                                          |
| Phone numbers anywhere                                                                                                                                  | `+447700900<nnn>`                                                                 |
| Base64 text anywhere                                                                                                                                    | Decoded, scrubbed with the rules above and encoded again                          |

Stand-ins are stable within one recording: the same value always gets the
same stand-in, so a test can still see that the page token in one response is
the one sent in the next request.

## What an integration declares

The scrubber never guesses which fields hold the user's own content, so
each integration says so itself. Today that's a `ScrubPolicy` object; once the
permission sheet is settled it becomes a `recording:` section in
`integration.yaml` with the same fields.

```ts
import { definePolicy } from "@halonicjs/tooling-record";

export const recordingPolicy = definePolicy({
  // Headers that carry a secret for this integration, in any casing.
  secretHeaders: ["x-goog-api-key"],

  // Query parameters, form fields and JSON fields that carry a secret,
  // when their names don't already say so.
  secretFields: ["upload_id"],

  // Fields with the user's own content: mail bodies, subjects, chat text, file
  // contents. Each value becomes a placeholder of the same type ("scrubbed user content", 0, false).
  // Dots for nested fields, [] for every item of a list, * for any field name, $ for the whole body.
  // A form field is just its name.
  userContent: {
    request: ["raw"],
    response: [
      "messages[].snippet",
      "messages[].payload.headers[].value",
      "messages[].payload.parts[].body.data",
    ],
  },

  // Bodies that are neither JSON nor form data stop the recording, unless
  // their content type is listed here. They still get the key, e-mail and
  // phone rules, but there are no field names to go by.
  textContentTypes: ["text/plain"],
});
```

After each recording, the recorder prints how many values each rule
replaced, and lists any `userContent` path that matched nothing. That's
usually a typo, and it means content you meant to remove is still there.

## When the recorder refuses to save

- A body isn't JSON or form data, and its content type isn't in `textContentTypes`.
- A body says it is JSON but doesn't parse.
- A URL can't be parsed.

The error names the place (`exchanges[2].response.body`) and the reason,
never a value.

## The safety net

After scrubbing, `prepareRecording` builds the exact file text and scans all
of it once more, separately from the rules: for the key values the kit
added (also encoded, JSON-escaped or in pieces), the `halonic-fake-` prefix
every fake key in our tests carries, known token shapes, e-mail addresses
and phone numbers, also inside base64. If it finds anything, a rule missed
it, and nothing is saved.

## The recording file

`integrations/<name>/recordings/<scenario>.json` (layout to be confirmed with
the conformance suite):

```json
{
  "format": "halonic-recording/1",
  "integration": "gmail",
  "scenario": "list-messages",
  "exchanges": [
    {
      "request": { "method": "GET", "url": "https://...", "headers": [["authorization", "Bearer scrubbed-secret-1"]], "body": { "type": "empty" } },
      "response": { "status": 200, "headers": [["content-type", "application/json"]], "body": { "type": "json", "value": {} } }
    }
  ]
}
```

Headers are `[name, value]` pairs in lower case, so repeated headers
survive. Bodies are saved parsed (`empty`, `json`, `form` or `text`), so a
reviewer can read them in a pull request.

## Still read every recording

The rules catch what they can recognise. A name, an address or a sentence
that isn't declared as user content stays. Read every recording before you
commit it.
