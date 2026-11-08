# tooling/record

`pnpm record <integration>` records an integration's real HTTP traffic so
the conformance suite can replay it. Both repos are public, so nothing is
saved until the scrubber has removed keys, tokens, e-mail addresses, phone
numbers and the user's own content.

`src/scrub` has no repo-specific imports and no I/O, so it can move into the
shared kit for "Offer to Halonic" (I6) unchanged.

## What is always removed

| What                                                                                                                                                    | How                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `authorization`, `proxy-authorization`, `x-api-key`, `api-key`, `x-auth-token`                                                                          | Value becomes `<scrubbed:secret>`; a scheme such as `Bearer ` is kept              |
| `cookie`, `set-cookie`                                                                                                                                  | Value becomes `<scrubbed:secret>`                                                  |
| A user name or password in a URL                                                                                                                        | Removed                                                                            |
| The key values the kit added during the recording, anywhere, including URL-encoded, base64-encoded or split into pieces                                 | `<scrubbed:secret>`                                                                |
| Query parameters and form fields named like a secret (`key`, `api_key`, `access_token`, `token`, `sig`, `code`, `*token*`, `*secret*`, `password`, ...) | `<scrubbed:secret>` for the integration's own key, otherwise `scrubbed-secret-<n>` |
| JSON fields named like a secret, when the value is a string                                                                                             | The same. Numbers stay, so `max_tokens: 1024` survives                             |
| Token-shaped values anywhere (JWTs, `sk-...`, `ghp_...`, `AIza...`, `ya29....`, `xox?-...`, AWS key IDs, ...)                                           | `scrubbed-secret-<n>`                                                              |
| Long random-looking values anywhere                                                                                                                     | `scrubbed-secret-<n>`                                                              |
| E-mail addresses anywhere                                                                                                                               | `person<n>@example.com`                                                            |
| Phone numbers anywhere                                                                                                                                  | `+447700900<nnn>`                                                                  |
| Base64 text anywhere                                                                                                                                    | Decoded, scrubbed with the rules above and encoded again                           |
| Headers that change on every run (`date`, `server`, request and trace IDs, rate limits, `content-length`, ...)                                          | Left out of the file                                                               |

`<scrubbed:secret>` marks the integration's own key: on replay, the
conformance suite puts its fake key back in there. Tokens the service issued
(page tokens, upload IDs, session IDs) get numbered stand-ins instead. They
are stable within one recording, so a test can still see that the page token
in one response is the one sent in the next request, and they need no
escaping in a URL.

## What an integration declares

The scrubber never guesses which fields hold the user's own content, so
each integration says so itself, in `integration.yaml`:

- **Secret headers** come from the permission sheet's `secrets` /
  `auth: { as }` declarations. They aren't listed a second time.
- **Everything else** goes in the `recording:` section:

```yaml
recording:
  # Fields with the user's own content: mail bodies, subjects, chat text, file
  # contents. Each value becomes a placeholder of the same type
  # ("<scrubbed:content>", 0 or false).
  userContent:
    - response.body.messages[*].snippet
    - response.body.payload.parts[*].body.data
    - response.body[*].data.delta.text # streamed text, in every event
    - request.body.raw
  # Query parameters, form fields and JSON fields that carry a secret, when
  # their names don't already say so. Optional.
  secretFields: [upload_id]
  # Bodies that aren't JSON, form data or an event stream stop the recording,
  # unless their content type is listed here. They still get the key, e-mail
  # and phone rules, but there are no field names to go by. Empty by default.
  allowContentTypes: []
```

Paths start at `request.body` or `response.body`, then use `.name` for a
field, `.*` for any field name, `[*]` for every item of a list and `[n]` for
one item. A form field is `request.body.<name>`. In an event stream, the body
is the list of events, so `response.body[*].data` is each event's data.
`request.body` alone means the whole body. A path the recorder can't read
stops the recording.

Until the recorder reads `integration.yaml`, the same fields are passed as an
object with `definePolicy({ secretHeaders, secretFields, userContent, allowContentTypes })`.

After each recording, the recorder prints how many values each rule
replaced, and lists any `userContent` path that matched nothing. That's
usually a typo, and it means content you meant to remove is still there.

## When the recorder refuses to save

- A body isn't JSON, form data or an event stream, and its content type isn't in `allowContentTypes`.
- A body says it is JSON but doesn't parse.
- A URL can't be parsed.
- A `userContent` path can't be read.
- The finished file doesn't match the recording format.

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

`integrations/<name>/recordings/<scenario>.json`, one file per scenario. The
Zod schema in `src/format.ts` is the contract the conformance suite reads.

```json
{
  "exchanges": [
    {
      "request": {
        "body": {
          "kind": "empty"
        },
        "headers": {
          "authorization": "Bearer <scrubbed:secret>"
        },
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages"
      },
      "response": {
        "body": {
          "kind": "json",
          "value": {
            "messages": [
              {
                "id": "m1",
                "snippet": "<scrubbed:content>"
              }
            ]
          }
        },
        "headers": {
          "content-type": "application/json"
        },
        "status": 200
      },
      "transport": "http"
    }
  ],
  "format": "halonic.recording/1",
  "integration": "gmail",
  "scenario": "list-messages",
  "scrubReport": [
    {
      "count": 1,
      "path": "exchanges[0].request.headers.authorization",
      "rule": "secret-header"
    },
    {
      "count": 1,
      "path": "exchanges[0].response.body.messages[0].snippet",
      "rule": "user-content"
    }
  ]
}
```

- Keys are sorted at every level and indented by 2, so the same recording
  always gives the same text.
- Exchanges are in call order. Each is tagged by `transport` (only `http`
  today), so local MCP programs can add `stdio` later.
- Header names are lower case; repeated headers are joined with `, `.
- Bodies are saved parsed: `empty`, `json`, `form` (a list of
  `[name, value]` pairs), `text` (with `contentType`) or `sse` (a list of
  `{ event, data }`, with `data` parsed when it is a JSON object or list).
- `scrubReport` names the rule, the place and how often. Never a value.
- No timestamps or machine details.

## Still read every recording

The rules catch what they can recognise. A name, an address or a sentence
that isn't declared as user content stays. Read every recording before you
commit it.
