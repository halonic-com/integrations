# tooling/record

`pnpm record <sheet id or path>` records an integration's real HTTP traffic so
the conformance suite can replay it. Both repos are public, so nothing is
saved until the scrubber has removed keys, tokens, e-mail addresses, phone
numbers and the user's own content.

`src/scrub` has no repo-specific imports and no I/O, so it can move into the
shared kit for "Offer to Halonic" (I6) unchanged.

## What is always removed

| What                                                                                                                                                                                                                                                                                                                                         | How                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `authorization`, `proxy-authorization`, `x-api-key`, `api-key`, `x-auth-token` and the headers the integration declares                                                                                                                                                                                                                      | Value becomes `<scrubbed:secret>`; a scheme such as `Bearer ` is kept, in any case                                 |
| `cookie`, `set-cookie`                                                                                                                                                                                                                                                                                                                       | Value becomes `<scrubbed:secret>`                                                                                  |
| Other headers named like a secret (`X-Access-Token`, `Private-Token`, `X-Session-Id`, ...)                                                                                                                                                                                                                                                   | `<scrubbed:secret>` for the integration's own key, otherwise `scrubbed-secret-<n>`; the scheme is kept             |
| A user name or password in a URL                                                                                                                                                                                                                                                                                                             | Removed                                                                                                            |
| The key values the kit added during the recording, anywhere, including URL-encoded, form-encoded, base64-encoded or split into pieces                                                                                                                                                                                                        | `<scrubbed:secret>`                                                                                                |
| Query parameters and form fields named like a secret (`key`, `api_key`, `access_token`, `token`, `sig`, `code`, `pass`, `*token*`, `*secret*`, `password`, ...), also in a relative `Location` and in a URL inside a query value. `code` also in a JSON object with a `grant_type` (an OAuth token request)                                  | `<scrubbed:secret>` for the integration's own key, otherwise `scrubbed-secret-<n>`                                 |
| JSON fields named like a secret                                                                                                                                                                                                                                                                                                              | The same for every string in the value, also inside a list or object. Numbers stay, so `max_tokens: 1024` survives |
| Token-shaped values anywhere (JWTs, `sk-...`, `ghp_...`, `AIza...`, `GOCSPX-...`, `ya29....`, `xox?-...`, AWS key IDs, ...)                                                                                                                                                                                                                  | `scrubbed-secret-<n>`                                                                                              |
| Long random-looking values anywhere                                                                                                                                                                                                                                                                                                          | `scrubbed-secret-<n>`                                                                                              |
| E-mail addresses anywhere                                                                                                                                                                                                                                                                                                                    | `person<n>@example.com`                                                                                            |
| Phone numbers anywhere                                                                                                                                                                                                                                                                                                                       | `+447700900<nnn>`                                                                                                  |
| Base64 text anywhere                                                                                                                                                                                                                                                                                                                         | Decoded, scrubbed with the rules above and encoded again, so it still decodes                                      |
| Google's error text in a response from a `*.googleapis.com` host whose `error` is an object: `error.message`, `error.errors[*].message` and the free-text fields of `error.details`. It can repeat what was sent. `code`, `status`, `reason`, `domain`, `@type` and `retryDelay` stay. OAuth errors, where `error` is a code, are left alone | The user-content placeholder, as if the sheet declared the paths                                                   |
| Headers that name the account behind the key (`anthropic-organization-id`, `anthropic-workspace-id`, `openai-organization`, `openai-project`)                                                                                                                                                                                                | Left out of the file                                                                                               |
| Headers that change on every run or no longer fit the saved body (`date`, request and trace IDs, rate limits, `content-length`, `content-encoding`, ...)                                                                                                                                                                                     | Left out of the file                                                                                               |

`<scrubbed:secret>` marks the integration's own key: on replay, the
conformance suite puts its fake key back in there. Tokens the service issued
(page tokens, upload IDs, session IDs) get numbered stand-ins instead. They
are stable within one recording, so a test can still see that the page token
in one response is the one sent in the next request, and they need no
escaping in a URL.

Addresses on `example.com` and numbers in the drama range are kept as they
are. One of them can look like a stand-in (`person2@example.com`), so the
recorder scrubs a recording twice: the first pass finds the ones it keeps,
and the second skips their numbers. A real address never gets the stand-in
of an example address in the same file.

## What an integration declares

The scrubber never guesses which fields hold the user's own content, so
each integration says so itself, in `integration.yaml`. The one exception
is a service error format the recorder knows: Google's error text is
removed for every Google integration (see the table above), so its sheets
don't list those paths. A sheet can't opt out of them yet.

- **Secret headers** come from the permission sheet's `secrets` /
  `auth: { as }` declarations. They aren't listed a second time.
- **Everything else** goes in the `recording:` section:

```yaml
recording:
  # Fields with the user's own content: mail bodies, subjects, chat text, file
  # contents. Each value becomes a placeholder of the same type
  # ("<scrubbed:content>", 0 or false). An empty string stays empty.
  userContent:
    - response.body.messages[*].snippet
    - response.body.payload.parts[*].body.data
    - response.body[*].data.delta.text # streamed text, in every event
    - request.body.raw
    - request.query.q # a search in the request URL's query string
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
one item. A form field is `request.body.<name>`. A query parameter of the
request URL is `request.query.<name>`, one name without wildcards; it doesn't
reach a URL inside a query value or in a response header. In an event
stream, the body is the list of events, so `response.body[*].data` is each event's data.
`request.body` alone means the whole body. A path the recorder can't read
stops the recording.

Some APIs send JSON inside a string, such as OpenAI's tool arguments
(`"arguments": "{\"city\":\"Ghent\"}"`). A placeholder there would no
longer parse on replay, so the recorder keeps such a string valid JSON:

- Declare the string itself (`...function.arguments`) and every value inside
  it becomes a placeholder, with the field names numbered:
  `{"field-1":"<scrubbed:content>"}`.
- Let the path go on inside the string (`...function.arguments.*`) to keep
  the field names: `{"city":"<scrubbed:content>"}`. Use this when the names
  come from the integration, like a tool's parameters.

When a path goes on inside a string that isn't JSON (arguments cut off at the
token limit), the whole string becomes `"<scrubbed:content>"`.

A streamed tool call sends its arguments in pieces, and no piece is JSON on
its own: Anthropic's `delta.partial_json`, OpenAI's
`choices[*].delta.tool_calls[*].function.arguments`. A placeholder in each
piece would no longer join to JSON on replay, so declare the pieces in
`streamedJson` too:

```yaml
recording:
  streamedJson:
    - response.body[*].data.delta.partial_json
  userContent:
    - response.body[*].data.delta.partial_json.*
```

Before any rule runs, the recorder joins the pieces of each text into its
first piece and leaves the others empty, so `{"city": "Gh` + `ent"}` becomes
`{"city":"<scrubbed:content>"}` + `""`. Pieces belong together when the
objects along their path hold the same `index` values: the event's `index`
for Anthropic, `choices[*].index` and `tool_calls[*].index` for OpenAI. The
`userContent` paths then work as they do on complete JSON. Paths in
`streamedJson` start at `response.body[*].data`.

When a path meets a value of another shape than it expects (a list where `.*`
wants fields, or fields where `[*]` wants a list), every value from there on
becomes a placeholder, as if that value itself were declared. This holds at
any depth, in a body and inside a JSON string alike: with
`...arguments.trip.*`, the arguments `{"trip":["Ghent","Bruges"]}` become
`{"trip":["<scrubbed:content>","<scrubbed:content>"]}`.

The body itself is the one exception, when another declared path fits it. A
service that answers either as a JSON object or as an event stream, as an MCP
server does, declares paths for both: `response.body.result.content[*].text`
and `response.body[*].data.result.content[*].text`. A JSON answer then takes
the first, an event stream the second. A body that no declared path fits
still becomes placeholders as a whole.

Until the recorder reads `integration.yaml`, the same fields are passed as an
object with `definePolicy({ secretHeaders, secretFields, userContent, streamedJson, allowContentTypes })`.

After each recording, the recorder prints how many values each rule
replaced. A `userContent` path that matched nothing stops the recording:
that's usually a typo, and it means content you meant to remove is still
there. When a scenario really doesn't touch a path (a read-only scenario and
`request.body.raw`), list the path in the scenario's `unusedUserContent`.
With paths for both kinds of answer, a scenario that only gets JSON answers
lists the event-stream paths there, and the other way round: a path of the
other kind can't match anything in its bodies.
The error paths the recorder adds by itself never stop a recording this way.

## When the recorder refuses to save

- A body isn't JSON, form data or an event stream, and its content type isn't in `allowContentTypes`.
- A body says it is JSON but doesn't parse.
- A URL can't be parsed.
- A `userContent` path can't be read, or matches nothing and isn't listed as unused.
- The finished file doesn't match the recording format.

The error names the place (`exchanges[2].response.body`) and the reason,
never a value.

## Recording a scenario

Write the scenarios in `integrations/<group>/<name>/recordings/scenarios.ts`.
It exports the integration and a list of scenarios. Each scenario uses the
connection the way a user would: it calls a tool, or `chat` on the model
provider. The file is integration code, so it gets no Node APIs and no
`fetch`, only the connection. It is never exported from the package, and
the integration's `tsconfig.json` includes it so it is typechecked.

It imports nothing from tooling either: `pnpm check` treats it as runtime
code, and integrations ship without tooling packages. The `Scenario` type
goes in the integration's own `src/kit.ts`, next to the kit types copied
there, with the integration's own connection type. Copy it from
`integrations/models/anthropic/src/kit.ts` when you write an integration's
first scenarios. `pnpm record` checks the shape again when it loads the file.

```ts
// integrations/models/anthropic/src/kit.ts
export interface Scenario {
  readonly name: string;
  readonly unusedUserContent?: readonly string[];
  run(connection: IntegrationConnection): Promise<void>;
}
```

```ts
// integrations/models/anthropic/recordings/scenarios.ts, shortened
import { anthropic } from "../src/index.ts";
import type { Scenario } from "../src/kit.ts";

export const integration = anthropic;
export const scenarios: readonly Scenario[] = [
  {
    name: "answer-text", // saved as recordings/answer-text.json
    unusedUserContent: ["request.body.tools[*].description" /* , ... */],
    async run(connection) {
      const provider = connection.createLlmProvider?.({
        id: "claude",
        type: "anthropic",
        local: false,
        options: {},
      });
      await provider?.chat({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Say hello." }],
      });
    },
  },
];
```

Then name the integration by its sheet `id` or its path, and optionally the
scenarios to record:

```sh
HALONIC_RECORD_SECRET_ANTHROPIC_KEY=... pnpm record model-anthropic answer-text
pnpm record integrations/tools/mcp/http   # every scenario
```

- **Keys** come from `HALONIC_RECORD_SECRET_<SECRET>`, named after the
  sheet's secret: `anthropic-key` becomes `HALONIC_RECORD_SECRET_ANTHROPIC_KEY`.
  **Settings** such as an MCP server's `url` come from
  `HALONIC_RECORD_SETTING_<SETTING>`, because a self-hosted server's address
  can be personal. Neither is ever taken from the command line. If one is
  missing, the command names the variable and stops before it sends anything.
  An `optional: true` secret that isn't set is simply not sent.
- **The host** is a stand-in for the kit's, in `src/host`, until
  `@halonicjs/integration-kit` is published. It copies the kit's rules: keys
  go only where the sheet's `as:` says (`bearer`, or `header` with `header:`
  and `prefix:`), and only to the sheet's hosts. Any other `as:` stops the
  command. A request to a host that isn't in the sheet fails the scenario,
  even if the integration catches the error.
- **Nothing is saved unless every scenario passes.** A scenario fails when it
  throws, when the host refused a request, or when `prepareRecording` refuses
  the result. Every printed line has each `HALONIC_RECORD_*` value removed,
  so no message or stack trace shows a key or a server address. A URL
  setting's bare host name is removed too, so with
  `HALONIC_RECORD_SETTING_URL=http://localhost:8080/mcp` every `localhost`
  in the output is hidden. That is on purpose.

## Capturing the traffic

`createRecordingTransport` wraps the real transport and keeps every
exchange it carries. It goes under the kit, as the `transport` of
`createIntegrationHost`, so it sees each request after the kit has placed
the keys and checked the host, and a redirect as one exchange per hop.
Its exchanges go straight to `prepareRecording`, with the key values the kit
placed as `knownSecrets`; they are never written anywhere as they are.

It answers as soon as the real transport does and keeps each piece of the
body as the kit reads it, so the kit's timeouts and size limit work the same
while recording. The recorded body is what the kit read: a body the kit
cancels, such as a redirect hop's, is kept only as far as it got. Take the
exchanges once the scenario has finished.

## The safety net

After scrubbing, `prepareRecording` builds the exact file text and scans all
of it once more, separately from the rules: for the key values the kit
added (also encoded, JSON-escaped or in pieces), the `halonic-fake-` prefix
every fake key in our tests carries, known token shapes, e-mail addresses
and phone numbers, also inside base64 and inside URL-encoded text, so
`from%3Aperson%40mail.test` in a query string is found too. Then it reads
the file and checks that every header, query parameter, form field and JSON field named like a
secret holds a stand-in, since a short password has no shape to find. If it
finds anything, a rule missed it, and nothing is saved.

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

## Replaying a recording in tests

`@halonicjs/tooling-record/replay` plays a recording file back as
`host.http`, the way the conformance suite will, so an integration's tests
run on the recordings it ships:

```ts
import { replay } from "@halonicjs/tooling-record/replay";
import listMessages from "../recordings/list-messages.json" with { type: "json" };

// The request paths of the integration's `recording` section.
const policy = { userContent: ["request.body.raw"] };

const recording = replay(listMessages, { policy });
// ... call the integration with `recording.http` as its host's HTTP client ...
expect(recording.sent[0]?.body).toEqual({ q: "is:unread" });
recording.assertAllUsed();
```

- Each call must be the next exchange's method and URL. An unexpected call
  fails, and `assertAllUsed` fails when an exchange wasn't used. A recorded
  URL is scrubbed, so the replay first scrubs the sent URL by the same
  rules: a query parameter the policy declares, such as `request.query.q`,
  matches its placeholder whatever the test searches for, and one it doesn't
  declare fails.
- The key must be in the header the request asks the kit to put it in, and
  in no other. A header the integration sets must have the recorded value,
  when the recording kept it. A stand-in the recording has in a request
  header, such as a session ID, must be sent back.
- The request body must match the recorded one. A recorded body is
  scrubbed, so the replay first scrubs the sent body with the same rules and
  the integration's policy, passed as `policy`. Then JSON is compared by
  value, form data and text (such as a multipart upload) line by line. The
  first difference fails the call with its place, such as
  `request.body.messages[0].role` or `line 6`. Stand-ins match whatever their
  number, and a text body needs no `allowContentTypes`: its recorded content
  type is allowed.
- Without the policy, a field or query parameter the recorder replaced as
  user content doesn't match. Pass the request paths of the `recording` section in
  `integration.yaml`.
- Check what the integration sent, unscrubbed, through `sent`: a JSON body
  parsed, any other body as text. A recording can't show user content, such
  as an instruction the integration adds to the messages.
- The response has `status`, `headers`, `text()`, `json()` and `body` as a
  byte stream, with an event stream in its wire format.
- `fakeResponse` answers every call with one status and body, for error
  paths a recording can't show.

It is for integration tests only. Add `@halonicjs/tooling-record` to
`devDependencies`, never to `dependencies`, and import it only from test
files: integrations ship without it. It will be replaced by
`@halonicjs/testing-integration` once that is published.

## Still read every recording

The rules catch what they can recognise. A name, an address or a sentence
that isn't declared as user content stays. Read every recording before you
commit it.
