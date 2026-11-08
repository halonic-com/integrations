# Writing a Halonic integration

People and the Studio assistant both write integrations to these rules.
When the assistant writes or changes an integration, it follows this guide
word for word. Worked examples for Gmail, Drive and a model provider are in
[integration-examples.md](integration-examples.md).

Integrations are built to the integration interface in the main repo: the
`Integration` port and the kit, `@halonicjs/integration-kit`. Integration
code imports everything from the kit, including the port types
(`Integration`, `IntegrationHost`, `ChatRequest`, ...), and never from
`@halonicjs/ports`, which isn't published. Where that interface is still
being settled, this guide says so in a **Not settled yet** note, and it
changes when the interface does. The rules themselves stay.

**Must** and **never** in this guide are hard rules. Section 10 lists them
and says, for each one, what enforces it: the kit, `pnpm check`, the
conformance suite or a person.

> **Not settled yet:** the kit doesn't re-export the port types yet. The
> imports in this guide show where they will come from.

## Contents

1. [What an integration is](#1-what-an-integration-is)
2. [Where it goes and what it's called](#2-where-it-goes-and-what-its-called)
3. [The permission sheet comes first](#3-the-permission-sheet-comes-first)
4. [Talking to the service](#4-talking-to-the-service)
5. [Tools](#5-tools)
6. [Model providers, MCP and knowledge sources](#6-model-providers-mcp-and-knowledge-sources)
7. [Errors](#7-errors)
8. [Readable code](#8-readable-code)
9. [Tests and recordings](#9-tests-and-recordings)
10. [What an integration must never do](#10-what-an-integration-must-never-do)
11. [Shipping](#11-shipping)

## 1. What an integration is

An integration is one package that connects Halonic to one outside
service. It provides one or more of:

- **tools** that agents call, such as `gmail_search` (`connector`);
- **a model provider**, such as Anthropic or OpenAI (`llm`);
- **a knowledge source** that agents search (`knowledge`).

Its package exports one `Integration` object: its `name`, `version`, the
`tools` it offers and `connect(host)`. Halonic calls `connect` with an
`IntegrationHost`, and that host is all the integration gets:

| Member          | What it is                                                                         |
| --------------- | ---------------------------------------------------------------------------------- |
| `host.http`     | an HTTP client that only reaches the hosts the permission sheet declares           |
| `host.tokens`   | a store for the tokens the integration keeps itself, limited to the declared names |
| `host.settings` | the settings the workspace gives it, such as a base URL. Never a secret value      |

There is no file system, no process, no raw `fetch` and no secret values.
An integration reaches the outside world only through `host.http`, and
Halonic adds the keys for it.

All state lives in the connection that `connect` returns. The module itself
holds only constants: in the cloud runtime one module serves many
workspaces, so a cache or a token kept at module level would carry one
workspace's data into another's.

## 2. Where it goes and what it's called

Integrations are grouped by provider account, like the folders in a hub:

```
integrations/
├─ models/                one folder per model provider
│  ├─ anthropic/          model-anthropic
│  ├─ openai/             model-openai
│  └─ gemini/             model-gemini (API key, not the Google sign-in)
├─ tools/                 providers whose services give agents tools
│  └─ google/
│     ├─ shared/          a library, not an integration: Google requests and errors
│     ├─ gmail/           tool-google-gmail
│     └─ drive/           tool-google-drive
├─ knowledge/             knowledge sources
│  └─ mcp/                knowledge-mcp
└─ mcp/                   mcp: our own MCP client
```

- A **model provider** goes in `integrations/models/<provider>/`.
- A **service with tools** goes in `integrations/tools/<provider>/<service>/`,
  even when the provider has only one service today. A new provider
  follows the same pattern: `tools/microsoft/outlook/`,
  `tools/microsoft/onedrive/`.
- A **knowledge source** goes in `integrations/knowledge/<source>/`.
- **Code shared by one provider's services** lives once, in that
  provider's `shared/` folder: `tools/google/shared/` holds the Google
  request helper, retries and Google error handling for Gmail and Drive.
  A `shared/` folder is a **library**, not an integration: it has no
  permission sheet, no tools and no `Integration`. Never copy its code into
  a service.
- An integration that belongs to no group sits directly in
  `integrations/<name>/`.

Each service is still its own integration. The user connects a Google
account once and ticks the services they want, and Halonic asks Google only
for the ticked services' permissions. The Google sign-in and the token
refresh belong to Halonic itself, not to any integration: Gmail and Drive
never see the refresh token or the client secret.

### Names

Every name follows from the folder, so nobody has to invent one:

| What                                | Rule                                                                                                                    | Gmail                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| integration name (the sheet's `id`) | the folders below `integrations/` joined by `-`, with `tools` → `tool`, `models` → `model` (`knowledge` stays the same) | `tool-google-gmail`                        |
| npm package (private)               | `@halonicjs/integration-<integration name>`; a shared library gets the same rule (`...-tool-google-shared`)             | `@halonicjs/integration-tool-google-gmail` |
| tool                                | `<service>_<verb>` or `<service>_<verb>_<thing>`, lower case with `_`                                                   | `gmail_search`, `gmail_read_message`       |
| secret reference                    | `<provider>-<what>`, lower case with `-`                                                                                | `google-account`                           |
| token                               | lower case with `-`                                                                                                     | `refresh`                                  |
| source file                         | lower case with `-`, one concern per file                                                                               | `read-message.ts`                          |

Tool names start with the service so they stay unique when a workspace
connects many integrations, and workspaces refer to them in their `allow`
and `approve` lists. **Never rename a tool that has shipped.** Add a new
one and keep the old one working until a release note retires it.

> **Not settled yet:** `pnpm check` still expects one folder level,
> `integrations/<name>`. The change that teaches it the grouped layout and
> these names follows in its own pull request.

### What is in an integration's folder

```
integrations/tools/google/gmail/
├─ integration.yaml       the permission sheet (section 3)
├─ package.json           name, "private": true, "halonic": { "layer", "owner" }
├─ README.md              what it does, how to connect it, its limits
├─ src/index.ts           exports the Integration; the only public entry
├─ src/client.ts          talks to the service: URLs, auth, response checks
├─ src/tools/<tool>.ts    one file per tool: declaration, argument schema, run
├─ src/tools/<tool>.test.ts
└─ recordings/<scenario>.json   scrubbed recorded responses (section 9)
```

An integration outside a group also has `src/errors.ts` with its error
type (section 7). A service in a group uses the group's error type
instead. A model provider has `src/provider.ts` (and the mapping files it
needs) instead of `src/tools/`.

## 3. The permission sheet comes first

Write `integration.yaml` before any code. It is what the user approves
before an integration the assistant wrote may run, so it must be complete
and honest. The kit enforces what it says about the network and secrets,
and the conformance suite fails when the code and the sheet disagree.

```yaml
id: tool-google-gmail
version: 1.0.0
kit: 1 # the version of the Integration port it was built against
provides: [connector]

# Exact host names of the service's own API. No wildcards, no IP addresses.
hosts:
  - gmail.googleapis.com

# Each secret the kit may add to a request: why, where it may go and how.
secrets:
  google-account:
    purpose: Access to the Google account you connect, through the Google sign-in.
    hosts: [gmail.googleapis.com]
    as: bearer

# Tokens the integration stores itself. Most integrations need none.
tokens: []

# Every text the model reads, word for word as in the code.
tools:
  - name: gmail_search
    description: >-
      Searches mail with Gmail search syntax. Returns id, thread, sender,
      subject, date and a short snippet per message. Read a whole message
      with gmail_read_message.
    arguments:
      query: Gmail search query, such as "from:billing is:unread newer_than:7d".
      pageToken: nextPageToken from the previous search, for more results.
    risk: read
    untrusted: true # results hold mail written by other people
  - name: gmail_send
    description: >-
      Sends an e-mail from the account. Sending can't be undone; prefer
      gmail_create_draft when a person should check it first.
    arguments:
      to: Recipient addresses, such as "someone@example.com".
      body: Plain-text body.
    risk: send
    untrusted: false # returns only ids

# Capabilities beyond HTTP, such as starting a program. Most need none.
needs: []

# Fields that hold the user's own content, for the recorder (section 9).
recording:
  userContent:
    - response.body.snippet
    - response.body.payload.headers[*].value
    - request.body.raw
```

Rules for each field:

- **`hosts`**: list every host the code calls, and nothing else. Each host
  must belong to the service the integration is named for, and serve its
  API. Never list a host that anyone can write to without an account, such
  as a paste site, a webhook catcher, a request bin or general file
  storage. A host the user chooses, such as a self-hosted server, is
  `{ fromSetting: <setting> }`. Plain `http` is only allowed to a host the
  user chose on this machine or a private network, and a **secret** goes
  over plain `http` only to this machine: the kit refuses anything else as
  `secret-over-plain-http`.
- **`secrets`**: one entry per key, token or password the service needs,
  with a `purpose` the user can understand, the narrowest `hosts` list that
  works, and where the kit puts it (`as`, plus `header` or `field`; see
  section 4). A secret may only go to hosts that are also in `hosts`. A
  secret that belongs to Halonic's own sign-in, such as `google-account`,
  goes only to that provider's hosts; never add another host to it.
- **`tokens`**: only for values the integration itself writes and reads
  back later. Keys the user enters are `secrets`, not `tokens`.
- **`tools`**: the same tools, in the same order, as the code declares. The
  `description` and the description of each argument (`arguments`) are the
  code's text, word for word: they are what the user approves, and they
  are what the model reads. `risk` and `untrusted` match the code, and
  every tool states `untrusted` as `true` or `false`; leaving it out is not
  allowed.
- **`needs`**: empty unless a reviewer agreed. Starting a local program
  (`process`) goes through the trust step and is never allowed in the
  cloud.
- **`limits`**: leave it out unless the defaults are too small. The kit
  allows 30 seconds until the response headers arrive, 60 seconds between
  two pieces of the body, 10 minutes in total and 10 MiB per response. Say
  in a comment which limit is too small and why.

> **Not settled yet:** the sheet is becoming a file kind in the main repo,
> so `halonic validate` can check it. The fields above follow the
> integration interface decision; small renames are still possible. In
> particular:
>
> - The kit names the limits `headersTimeoutMs`, `idleTimeoutMs`,
>   `timeoutMs` and `maxResponseBytes`; their names in the sheet may still
>   change.
> - The kit doesn't yet read `as` from the sheet, so it can't yet refuse a
>   secret placed anywhere else. Until it does, a reviewer compares each
>   `auth` in the code with the sheet.
> - The conformance suite doesn't yet compare descriptions or require
>   `untrusted`. Until it does, a reviewer compares them.
> - The Google sign-in will add a way to declare each service's Google
>   permissions.

## 4. Talking to the service

1. **All network access goes through `host.http.fetch(url, init)`.** `url`
   is a string; `init` takes the usual `fetch` options (`method`,
   `headers`, `body`, `signal`) plus `auth`. Never call `fetch`,
   `XMLHttpRequest` or `WebSocket` yourself, and never reach for
   `globalThis` or `process`.
2. **Never handle key values. Name the secret and let the kit add it:**

   ```ts
   const response = await host.http.fetch(url.href, {
     auth: { secret: "anthropic-key", as: "header", header: "x-api-key" },
     signal,
   });
   ```

   `as` is `"bearer"` (`Authorization: Bearer …`), `"header"` (a named
   header, with an optional `prefix`) or `"form"` (a named field in a form
   body). Put a secret only where the sheet says, and only where the
   service expects that secret. Never in a field the service stores or
   sends back, such as a name, a search query or a message. The kit refuses
   a secret the sheet doesn't declare (`secret-not-declared`), one sent to
   a host the sheet doesn't allow it for, and one the workspace hasn't set
   up yet (`secret-not-configured`).
3. **Keep all calls in one place.** `src/client.ts` holds the base URL, the
   `auth` placement, the request helpers and the response checks. Tools and
   providers call the client and never build requests themselves.
4. **Build URLs with `URL` and `URLSearchParams`, and pass `url.href`.**
   Never paste an argument into a URL as text: an id such as `../admin`
   must not change the path. Encode path parts with `encodeURIComponent`.
   The kit refuses a `URL` object as `bad-url`.
5. **Check every response with a Zod schema** before you use it. Describe
   only the fields you read, and let the rest pass (`z.object`, not
   `z.strictObject`), so a new field from the service doesn't break the
   integration.
6. **Pass `signal` on to every request.** A call the user cancels must stop.
7. **Read a setting such as a base URL from `host.settings`,** with the
   service's default when it's absent. The kit still refuses a host the
   sheet doesn't allow, so a setting can't send traffic anywhere else.
8. **Don't follow redirects yourself.** The kit follows them, checks every
   hop against the sheet and drops the secret when a hop leaves its hosts.
9. **Keep the number of requests per call small and fixed,** and say in a
   comment how many a tool makes at most ("one list request and at most 25
   message requests"). Never loop until the service stops answering.
10. **Retry only where it's safe:** at most twice, only on `429` and `5xx`,
    honouring `retry-after` up to 30 seconds, and only for requests that
    change nothing (`GET`) or that the service makes safe to repeat (an
    idempotency key). **Never retry a request that sends or deletes
    something:** a timeout doesn't prove it didn't happen. One provider's
    retry rules live once, in its group (`tools/google/shared`).

> **Not settled yet:** the kit doesn't limit the number of requests per
> call yet. Until it does, the comment and a reviewer do.

## 5. Tools

Each tool lives in its own file in `src/tools/`, with three parts: its
declaration, its argument schema and its `run` function.

```ts
import { type ToolImplementation } from "@halonicjs/integration-kit";
import { z } from "zod";

const searchArguments = z.strictObject({
  query: z
    .string()
    .max(500)
    .default("in:inbox")
    .describe('Gmail search query, such as "from:billing is:unread newer_than:7d".'),
  maxResults: z.int().min(1).max(25).default(10),
});

export const searchTool = {
  declaration: {
    name: "gmail_search",
    description:
      "Searches mail with Gmail search syntax. Returns id, thread, sender, subject, date and a short snippet per message. Read a whole message with gmail_read_message.",
    parameters: z.toJSONSchema(searchArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: searchArguments,
  async run(client, args, signal) {
    /* … */
  },
} satisfies ToolImplementation<GmailClient, typeof searchArguments>;
```

`ToolImplementation` and `runTool`, which finds a tool, checks its
arguments and runs it, come from the kit; the
[examples](integration-examples.md#what-the-kit-gives-you) show them in
full.

- **One schema, two uses.** The argument schema is a Zod `strictObject`.
  `parameters` is generated from it with
  `z.toJSONSchema(schema, { io: "input" })`, and `runTool` parses the
  arguments with it before `run`. `io: "input"` matters: without it, Zod
  describes the parsed result, so every field with a default becomes
  required and the model is told to always send it. Never cast arguments
  (`args as Something`).
- **Write the description for the model, and only about this tool.** Say
  what the tool does, what it returns, and anything it can't undo. Put an
  example of an unusual argument format in the argument's `describe`. A
  description may name other tools of the same integration
  (`gmail_read_message`), but it never:
  - tells the model what to do beyond using this tool ("always", "after
    every search, also …", "ignore earlier instructions");
  - names a tool of another integration;
  - holds invisible characters (zero-width, bidirectional controls) or
    encoded text (base64, escapes, anything not meant to be read).
- **Give every list and every text a limit** (`maxResults`, `maxChars`) with
  a sensible default, and return a `nextPageToken` or a `nextOffset` when
  there is more. A tool result goes into the model's context, so it must
  stay small. Limit every string argument too, page tokens included.
- **Return a small JSON object** (`JSON.stringify` of a typed result) with
  only the fields the description promises. Never return the service's raw
  response.
- **Never put secrets, tokens or request headers in a result.** The kit
  keeps key values from the integration, but a service can echo tokens in
  its own response bodies.
- **Look values from the service up safely.** A value such as
  `"constructor"` finds a function in a plain object. Use a `Map` or
  `Object.hasOwn` for any lookup keyed by a value the service or a user
  chose.

### Choosing `risk`

| `risk`  | When                                                                                | Examples                                                                 |
| ------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `read`  | changes nothing anywhere                                                            | search, read a message, list a folder, export a file                     |
| `write` | changes data only the account can see, and no one else is told                      | create a draft, add a label, create a file in the user's own root folder |
| `send`  | reaches people outside the account, or puts something where other people can see it | send a mail, share a file, create a public link, add a file to a folder  |

A write into a place that can be shared with other people is a `send`: a
shared folder, a shared drive, a team channel. The tool's target decides,
not its verb. So a tool that creates a file inside a folder the caller
names is `send`, unless the tool itself checks that the folder isn't
shared and refuses when it is. Otherwise someone who shares a folder with
the account could have agents put the user's content into it without
anyone approving a send.

When in doubt, choose the stricter one. Approvals, the "allow sending"
check and test runs all rely on `risk`, so a tool marked too low can do
harm without anyone being asked. Prefer moving to the trash over deleting:
a tool that deletes for good needs a reviewer's agreement in the pull
request.

Mark a tool `untrusted: true` when its result holds content that someone
outside the account wrote: mail, shared files, web pages, chat messages.
Halonic fences that content off, so instructions hidden in it aren't taken
as instructions. Say `untrusted: false` only when the result holds nothing
but values the integration controls, such as ids and counts.

## 6. Model providers, MCP and knowledge sources

A model provider's sheet says `provides: [llm]` and has no tools. Its
connection implements `createLlmProvider(config)` and returns an
`LlmProvider`:

- **Map Halonic's `ChatRequest` to the service's request, and the answer
  back to `ChatResponse`,** in separate, tested functions
  (`to-request.ts`, `from-response.ts`). Keep the provider class short.
- **Ignore `config.baseUrl` and `config.secret`.** Halonic maps the
  workspace's choices onto the sheet before `connect`: the base URL becomes
  the `fromSetting` host and the setting, and the chosen key becomes the
  secret the sheet names.
- **Report `capabilities` honestly.** Never claim `tools`, `vision` or
  `streaming` that the code doesn't handle.
- **Map every finish reason** to `stop`, `tool_calls`, `length`, `error` or
  `other`. An unknown one is `other`, never a crash.
- **Never send `meta`** (agent and run ids) to the provider.

An integration whose tools can change while it is connected, such as our
MCP client, also implements the connection's optional `listTools`. Every
other integration declares its tools once, in `tools`.

A knowledge source says `provides: [knowledge]` and implements
`createKnowledgeProvider(source)`. The same rules apply: one client, Zod
checks, limits on every result, and `untrusted` content marked as such.

> **Not settled yet:** streaming answers arrive with the first provider
> that streams. Write `chat` so that adding a streaming method later
> doesn't change it.

## 7. Errors

Errors reach the model, the user and the logs, so every message must be
safe to show and useful to read. An error message is also a way for the
service's text to reach the model, so it gets the same care as a tool
result.

1. **Each integration has one error type** with a `code` and a short
   message written for the user. An integration outside a group keeps it
   in `src/errors.ts`; a provider group shares one from its `shared/`
   folder, so Gmail and Drive both use `GoogleError`.

   ```ts
   export type AnthropicErrorCode =
     | "bad-arguments" | "not-signed-in" | "not-allowed" | "not-found"
     | "rate-limited" | "unavailable" | "unexpected-response";

   export class AnthropicError extends Error {
     override readonly name = "AnthropicError";
     constructor(readonly code: AnthropicErrorCode, message: string) {
       super(message);
     }
   }
   ```

2. **Map HTTP status codes in one function** in the client, the same way in
   every integration:

   | Status                  | `code`                | Message says                                   |
   | ----------------------- | --------------------- | ---------------------------------------------- |
   | `400`, `422`            | `bad-arguments`       | that the service refused the request (rule 4)  |
   | `401`                   | `not-signed-in`       | to reconnect the account or check the key      |
   | `403`                   | `not-allowed`         | that the account may not do this               |
   | `404`                   | `not-found`           | what wasn't found, by the id the caller passed |
   | `408`, `429`            | `rate-limited`        | to try again later                             |
   | `5xx`, and other limits | `unavailable`         | that the service is having trouble             |
   | a body Zod refuses      | `unexpected-response` | that the service answered in an unexpected way |

   Add codes the service really needs, such as `quota-exceeded`, but don't
   invent one per endpoint.

3. **Never copy the service's error text into a message.** It can echo the
   request, including the user's content, and a hostile service can write
   anything there. Use the status and, at most, the service's
   machine-readable error type (`invalid_request_error`,
   `rateLimitExceeded`), and only after checking it against
   `/^[a-z][a-z0-9_.-]{0,63}$/i` or a list of the types you know. Leave it
   out when it doesn't match.
4. **A `bad-arguments` message may name the argument the service refused,**
   only when the service says so in a structured field, and only when that
   name is one of the tool's own argument names. Never its value.
5. **Never let a parse error out.** The runtime's JSON parse errors quote
   part of the body, and a `ZodError` can hold values. Catch both and throw
   your own `unexpected-response`. Don't attach them as `cause`: a `cause`
   can end up in logs.
6. **Never put a query string, a header, a request body or a token into a
   message.** Name the host, the path without its query, and the id the
   caller passed, shortened to a sensible length.
7. **Let the kit's own errors through unchanged.** They are already safe to
   show:
   - `IntegrationRefusedError`, with codes such as `host-not-allowed`,
     `secret-not-declared` and `secret-not-configured`. The last one is what
     the user sees when no key is set up or the account isn't connected, so
     it must reach them as it is.
   - `IntegrationTimeoutError`. Its `name` is `"TimeoutError"`, so check
     for it with `instanceof IntegrationTimeoutError`, not by name.

   Catching them and retrying, or hiding them, is a bug.
8. **Invalid tool arguments** become `bad-arguments`, naming the path of
   each bad field (`maxResults`), never its value. `runTool` does this for
   you.
9. **Never swallow an error** to return an empty result. "No messages" and
   "couldn't search" must look different.

## 8. Readable code

Readable code over short code:

- **Small files with one concern each.** `pnpm check` warns above 300
  lines and fails above 500; it warns for functions above 60 lines.
- **Named functions and types for each step**, such as
  `toAnthropicMessages`, `parseSearchResult` or `errorForStatus`. Avoid
  clever one-liners.
- **A comment where the reason isn't obvious:** why a field is optional,
  why a limit has the value it has, which service quirk a branch handles.
  Link the service's documentation page for unusual behaviour.
- **`src/index.ts` names its exports** (no `export *`) and exports only the
  `Integration` and the types callers need.
- **Shared code goes where it belongs:** in the provider's `shared/`
  library for one provider (`tools/google/shared`), in the kit when every
  integration needs it. Never copy a helper between integrations; propose
  it for the kit instead.
- **No outside libraries apart from Zod.** We write HTTP, JSON, OAuth and
  MCP on `host.http` ourselves. The rare exception, a library for that one
  service that brings in nothing else, needs the approvals in
  [dependencies.md](dependencies.md).

## 9. Tests and recordings

Every integration is tested on recorded responses, so the tests run without
a network, without keys and the same way every time.

- **The shared conformance suite must pass**, in Node and in `workerd`. It
  checks that the code matches the sheet (name, version, tools, `risk`,
  `untrusted`), replays the recordings, and runs the attack tests: an
  integration that reaches an undeclared host, reads a file or leaks a key
  fails.
- **Write your own tests** for every mapping function and for each error
  path: every status in the table in section 7, a body Zod refuses, and a
  body that isn't JSON.
- **Behave the same in tests and in use.** What the code does must never
  depend on the time, the environment, a fetched configuration or whether
  it is being recorded or replayed. The attack tests only prove what they
  see.
- **Record with `pnpm record <integration>`** on your own machine, with
  your own test account. Each scenario is one file,
  `recordings/<scenario>.json`, named for what it shows
  (`search-two-pages.json`, `send-refused.json`). On replay, an unexpected
  call or an unused recording fails the test.
- **The recorder scrubs before it saves.** The integration's own keys
  become `<scrubbed:secret>`; tokens the service issued become
  `scrubbed-secret-1`, `scrubbed-secret-2` and so on, so a page token can
  still be followed from one call to the next; e-mail addresses and phone
  numbers get fictional stand-ins. A final scan refuses to save anything
  that still looks like a key or personal data.
- **Declare every field that holds the user's own content** in the sheet's
  `recording.userContent`: mail bodies and subjects, file contents and
  names, chat text, model prompts, answers and reasoning. The recorder
  never guesses these; an undeclared field stays as it was. Paths start at
  `request.body` or `response.body`: `response.body.files[*].name`,
  `response.body.content[*].text`. A path that ends at an object or a list
  scrubs every value inside it, field names included, so
  `response.body.content[*].input` covers a tool's nested arguments. Add
  `secretFields` for a field that carries a secret under a name that
  doesn't say so, and `allowContentTypes` for a body that isn't JSON, form
  data or an event stream.
- **Content outside a body can't be declared yet.** Paths can't reach the
  query string, the URL path or the response headers, so a search query in
  the URL or a file name in `Content-Disposition` is saved as it is. Record
  those scenarios only with text you made up: an invented search term, a
  test file with an invented name.
- **Read every recording before you commit it,** top to bottom, headers
  and URLs included. Any real name, address, subject or sentence that
  survived means a `userContent` path is missing: add it and record again.
  Never edit a recording by hand to hide something.
- **Use the fakes in tests:** `example.com` addresses, invented names and
  the kit's fake keys. Never a real account, person or key.

The recorder's README (`tooling/record/README.md`) has the recording
format and the full list of scrub rules.

> **Not settled yet:**
>
> - The conformance suite is published from the main repo as
>   `@halonicjs/testing-integration`, and `pnpm record` is in review. Until
>   both are on `main`, test the mapping functions and the error paths with
>   your own tests.
> - Today one missed `userContent` path publishes that field. The recorder
>   is to turn this around: scrub every string by default and keep only
>   the fields marked safe, and reach query strings, URL paths and response
>   headers. Until then, the reader of the recording is the last check.

## 10. What an integration must never do

This list is the checklist for every integration, whoever wrote it. Each
rule says what enforces it:

- **kit**: the kit refuses it at run time, whatever the code does;
- **check**: `pnpm check` or the TypeScript preset fails;
- **suite**: the conformance suite fails;
- **person**: only a person reviewing the change catches it.

For an integration the Studio assistant writes, the assistant checks the
result against this list too, but that is not a safety measure: content it
read earlier can steer it. What protects the user is the kit, the isolated
worker it runs in, and the permission sheet the user reads and approves.
That is why the sheet must say everything (section 3).

1. Reach the network any way other than `host.http`, or call a host its
   sheet doesn't list. _(kit)_
2. Read, hold, log or return a key, token or password value, or ask the
   user to paste one into a setting, a tool argument or a file. _(kit,
   person)_
3. Place a secret anywhere the sheet doesn't say, or in a field the service
   stores or sends back. _(person; kit once it reads `as` from the sheet)_
4. Use `eval`, `new Function`, an `import()` with a computed name,
   `node:*` modules, `process`, `globalThis` or the file system. _(check,
   for the direct forms; person for the rest)_ Lint is not a boundary. A
   reviewer also looks for the indirect routes: `(() => {}).constructor(…)`,
   `Reflect`, `WebAssembly`, `setTimeout` or `setInterval` with a string,
   `Worker`, `import.meta`, and encoded or obfuscated strings and blobs.
5. List a host that doesn't belong to the named service, a host anyone can
   write to, or add hosts to a secret of Halonic's own sign-in. _(person)_
6. Declare a tool with a lower `risk` than what it does, a write into a
   place that can be shared as anything but `send`, or a tool without an
   explicit `untrusted`. _(person; suite for `untrusted` once it checks)_
7. Write a tool description that instructs the model, names another
   integration's tools, or hides text; or let the code's descriptions
   differ from the sheet's. _(person; suite once it compares them)_
8. Do more than the user asked: no extra recipients, no sharing, no
   deleting, no changes outside the tool's description. _(person)_
9. Send a request from `connect`, or make an unbounded number of requests
   in one call. _(suite for `connect`; person for the count)_
10. Keep state at module level, or behave differently by time, environment,
    fetched configuration, or under test or replay. _(person)_
11. Retry a request that sends or deletes something. _(person)_
12. Put the service's error text, a parse error, a query string, a header
    or user content into an error message. _(person)_
13. Return the service's raw response, or a result without limits.
    _(person)_
14. Add an outside library, or copy one in as source code. _(check for
    `package.json`; person for copied code)_
15. Commit or upload a key, a token or personal data anywhere: code,
    tests, recordings, comments, commit messages or pull request text.
    That includes the names and e-mail addresses of real people. _(check:
    the secret scans; person: reading every recording)_
16. Rename a shipped tool, or change what its arguments mean. _(person)_
17. Change the checks, the recorder's rules or another integration in
    the same change. Each of those is its own pull request. _(person)_

## 11. Shipping

Small pull requests to `halonic-com/integrations`, never straight to
`main`, with a conventional title such as `feat(tool-google-gmail): add
gmail_send_draft`. The checks match the main repo's
([checks.md](checks.md)); run `pnpm verify` before you ask for review.

A new integration is usually three pull requests: the sheet and the
README, then the client and the first tools with their recordings, then
the remaining tools.

An integration offered from the Studio with "Offer to Halonic" goes
through the same checks, plus the personal-terms guard and the secret scan
over everything it adds, plus a review by a person against section 10.
