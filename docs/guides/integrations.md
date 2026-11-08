# Writing a Halonic integration

People and the Studio assistant both write integrations to these rules.
When the assistant writes or changes an integration, it follows this guide
word for word, and a reviewer checks the result against it. Worked examples
for Gmail, Drive and a model provider are in
[integration-examples.md](integration-examples.md).

Integrations are built to the integration interface in the main repo: the
`Integration` port in `@halonicjs/ports` and the kit,
`@halonicjs/integration-kit`. Where that interface is still being settled,
this guide says so in a **Not settled yet** note, and it changes when the
interface does. The rules themselves stay.

**Must** and **never** in this guide are hard rules: the checks, the
conformance suite or a reviewer will refuse a change that breaks one.

## Contents

1. [What an integration is](#1-what-an-integration-is)
2. [Where it goes and what it's called](#2-where-it-goes-and-what-its-called)
3. [The permission sheet comes first](#3-the-permission-sheet-comes-first)
4. [Talking to the service](#4-talking-to-the-service)
5. [Tools](#5-tools)
6. [Model providers and knowledge sources](#6-model-providers-and-knowledge-sources)
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
│     ├─ auth/            tool-google-auth: the one Google sign-in, shared, no tools of its own
│     ├─ gmail/           tool-google-gmail
│     └─ drive/           tool-google-drive
├─ mcp/                   mcp: our own MCP client
└─ knowledge-mcp/         knowledge-mcp
```

- A **model provider** goes in `integrations/models/<provider>/`.
- A **service with tools** goes in `integrations/tools/<provider>/<service>/`,
  even when the provider has only one service today. A new provider
  follows the same pattern: `tools/microsoft/outlook/`,
  `tools/microsoft/onedrive/`.
- **Code shared by one provider's services** lives once, in that
  provider's group: `tools/google/auth/` holds the Google sign-in, token
  refresh, retries and Google error handling for Gmail and Drive. Never
  copy it into a service.
- An integration that belongs to no provider sits directly in
  `integrations/<name>/`.

Each service is still its own integration. The user connects a Google
account once and ticks the services they want, and Halonic asks Google only
for the ticked services' permissions.

### Names

Every name follows from the folder, so nobody has to invent one:

| What                                | Rule                                                                                       | Gmail                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| integration name (the sheet's `id`) | the folders below `integrations/` joined by `-`, with `tools` → `tool`, `models` → `model` | `tool-google-gmail`                        |
| npm package (private)               | `@halonicjs/integration-<integration name>`                                                | `@halonicjs/integration-tool-google-gmail` |
| tool                                | `<service>_<verb>` or `<service>_<verb>_<thing>`, lower case with `_`                      | `gmail_search`, `gmail_read_message`       |
| secret reference                    | `<provider>-<what>`, lower case with `-`                                                   | `google-account`                           |
| token                               | lower case with `-`                                                                        | `refresh`                                  |
| source file                         | lower case with `-`, one concern per file                                                  | `read-message.ts`                          |

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
├─ src/errors.ts          the integration's error type (section 7)
├─ src/tools/<tool>.ts    one file per tool: declaration, argument schema, run
├─ src/tools/<tool>.test.ts
└─ recordings/<scenario>.json   scrubbed recorded responses (section 9)
```

A model provider has `src/provider.ts` (and the mapping files it needs)
instead of `src/tools/`.

## 3. The permission sheet comes first

Write `integration.yaml` before any code. It is what the user approves
before an integration the assistant wrote may run, so it must be complete
and honest. The kit enforces exactly what it says, and the conformance
suite fails when the code and the sheet disagree.

```yaml
id: tool-google-gmail
version: 1.0.0
kit: 1 # the version of the Integration port it was built against
provides: [connector]

# Exact https host names. No wildcards, no subdomains, no IP addresses.
hosts:
  - gmail.googleapis.com

# Each secret the kit may add to a request, why, and where it may go.
secrets:
  google-account:
    purpose: Access to the Google account you connect, through the Google sign-in.
    hosts: [gmail.googleapis.com]

# Tokens the integration stores itself. Most integrations need none.
tokens: []

tools:
  - name: gmail_search
    description: Searches mail with Gmail search syntax.
    risk: read
    untrusted: true # results hold mail written by other people
  - name: gmail_send
    description: Sends an e-mail from the account. Sending can't be undone.
    risk: send

# Capabilities beyond HTTP, such as starting a program. Most need none.
needs: []

# Fields that hold the user's own content, for the recorder (section 9).
recording:
  userContent:
    - response.body.messages[*].snippet
```

Rules for each field:

- **`hosts`**: list every host the code calls, and nothing else. A host the
  user chooses, such as a self-hosted server, is `{ fromSetting: <setting> }`.
  Plain `http` is only allowed to a host the user chose that is on this
  machine or a private network.
- **`secrets`**: one entry per key, token or password the service needs,
  with a `purpose` the user can understand and the narrowest `hosts` list
  that works. A secret may only go to hosts that are also in `hosts`.
- **`tokens`**: only for values the integration itself writes and reads
  back later. Keys the user enters are `secrets`, not `tokens`.
- **`tools`**: the same tools, in the same order, with the same `risk` and
  `untrusted` as the code's declarations (section 5).
- **`needs`**: empty unless a reviewer agreed. Starting a local program
  (`process`) goes through the trust step and is never allowed in the
  cloud.
- **`limits`**: leave it out unless the defaults (30 seconds per request,
  10 MiB per response) are too small, such as for long model answers or
  large exports. Say in a comment why.

> **Not settled yet:** the sheet is becoming a file kind in the main repo,
> so `halonic validate` can check it. The fields above follow the
> integration interface decision; small renames are still possible, and
> the Google sign-in will add a way to declare each service's Google
> permissions.

## 4. Talking to the service

1. **All network access goes through `host.http.fetch`.** It takes the same
   arguments as the Web `fetch`, plus `auth`. Never call `fetch`,
   `XMLHttpRequest` or `WebSocket` yourself, and never reach for
   `globalThis` or `process`.
2. **Never handle key values. Name the secret and let the kit add it:**

   ```ts
   const response = await host.http.fetch(url, {
     auth: { secret: "anthropic-key", as: "header", header: "x-api-key" },
     signal,
   });
   ```

   `as` is `"bearer"` (`Authorization: Bearer …`), `"header"` (any header,
   with an optional `prefix`) or `"form"` (a field in a form body, such as
   an OAuth `client_secret`). The kit refuses a secret the sheet doesn't
   declare, or one sent to a host the sheet doesn't allow it for.
3. **Keep all calls in one place.** `src/client.ts` holds the base URL, the
   `auth` placement, the request helpers and the response checks. Tools and
   providers call the client and never build requests themselves.
4. **Build URLs with `URL` and `URLSearchParams`.** Never paste an argument
   into a URL as text: an id such as `../admin` must not change the path.
   Encode path parts with `encodeURIComponent`.
5. **Check every response with a Zod schema** before you use it. Describe
   only the fields you read, and let the rest pass (`z.object`, not
   `z.strictObject`), so a new field from the service doesn't break the
   integration.
6. **Pass `signal` on to every request.** A call the user cancels must stop.
7. **Read a setting such as a base URL from `host.settings`,** with the
   service's default when it's absent. The kit still refuses a host the
   sheet doesn't allow, so a setting can't send traffic anywhere else.
8. **Retry only where it's safe:** at most twice, only on `429` and `5xx`,
   honouring `retry-after` up to 30 seconds, and only for requests that
   change nothing (`GET`) or that the service makes safe to repeat (an
   idempotency key). **Never retry a request that sends or deletes
   something:** a timeout doesn't prove it didn't happen. One provider's
   retry rules live once, in its group (`tools/google/auth`).

## 5. Tools

Each tool lives in its own file in `src/tools/`, with three parts: its
declaration, its argument schema and its `run` function.

```ts
const searchArguments = z.strictObject({
  query: z.string().max(500).describe("Gmail search query, such as is:unread newer_than:7d."),
  maxResults: z.int().min(1).max(50).default(20),
});

export const searchTool = {
  declaration: {
    name: "gmail_search",
    description:
      "Searches mail with Gmail search syntax. Returns sender, subject, date and a short snippet per message.",
    parameters: z.toJSONSchema(searchArguments),
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
arguments and runs it, are a small shared helper in `src/tool.ts`; the
[examples](integration-examples.md#the-shared-tool-helper) show it in full.

- **One schema, two uses.** The argument schema is a Zod `strictObject`.
  `parameters` is generated from it with `z.toJSONSchema`, and `callTool`
  parses the arguments with it before `run`. Never cast arguments
  (`args as Something`).
- **Write the description for the model.** Say what the tool does, what it
  returns, and anything it can't undo. Put an example of an unusual
  argument format in the argument's `describe`.
- **Give every list and every text a limit** (`maxResults`, `maxChars`) with
  a sensible default, and return a `nextPageToken` or a `nextOffset` when
  there is more. A tool result goes into the model's context, so it must
  stay small.
- **Return a small JSON object** (`JSON.stringify` of a typed result) with
  only the fields the description promises. Never return the service's raw
  response.
- **Never put secrets, tokens or request headers in a result.** The kit
  keeps key values from the integration, but a service can echo tokens in
  its own response bodies.

### Choosing `risk`

| `risk`  | When                                                                   | Examples                                                          |
| ------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `read`  | changes nothing anywhere                                               | search, read a message, list a folder, export a file              |
| `write` | changes data the account owns, and no one else is told                 | create a draft, add a label, create or move a file, move to trash |
| `send`  | reaches people outside the account, or makes something visible to them | send a mail, send a draft, share a file, create a public link     |

When in doubt, choose the stricter one. Approvals, the "allow sending"
check and test runs all rely on `risk`, so a tool marked too low can do
harm without anyone being asked. Prefer moving to the trash over deleting:
a tool that deletes for good needs a reviewer's agreement in the pull
request.

Mark a tool `untrusted: true` when its result holds content that someone
outside the account wrote: mail, shared files, web pages, chat messages.
Halonic fences that content off, so instructions hidden in it aren't taken
as instructions.

## 6. Model providers and knowledge sources

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

A knowledge source says `provides: [knowledge]` and implements
`createKnowledgeProvider(source)`. The same rules apply: one client, Zod
checks, limits on every result, and `untrusted` content marked as such.

> **Not settled yet:** streaming answers arrive with the first provider
> that streams. Write `chat` so that adding a streaming method later
> doesn't change it.

## 7. Errors

Errors reach the model, the user and the logs, so every message must be
safe to show and useful to read.

1. **Each integration has one error type** in `src/errors.ts`, with a
   `code` and a short message written for the user. A provider group
   shares one: Gmail and Drive both use `GoogleError` from
   `tools/google/auth`.

   ```ts
   export type GmailErrorCode =
     | "bad-arguments" | "not-signed-in" | "not-allowed" | "not-found"
     | "rate-limited" | "unavailable" | "unexpected-response";

   export class GmailError extends Error {
     override readonly name = "GmailError";
     constructor(readonly code: GmailErrorCode, message: string) {
       super(message);
     }
   }
   ```

2. **Map HTTP status codes in one function** in the client, the same way in
   every integration:

   | Status                  | `code`                | Message says                                      |
   | ----------------------- | --------------------- | ------------------------------------------------- |
   | `400`, `422`            | `bad-arguments`       | which argument the service refused, if it says so |
   | `401`                   | `not-signed-in`       | to reconnect the account or check the key         |
   | `403`                   | `not-allowed`         | that the account may not do this                  |
   | `404`                   | `not-found`           | what wasn't found, by the id the caller passed    |
   | `408`, `429`            | `rate-limited`        | to try again later                                |
   | `5xx`, and other limits | `unavailable`         | that the service is having trouble                |
   | a body Zod refuses      | `unexpected-response` | that the service answered in an unexpected way    |

   Add codes the service really needs, such as `quota-exceeded`, but don't
   invent one per endpoint.

3. **Never copy the service's error body into a message.** It can echo the
   request, including the user's content. Use the status and, at most, the
   service's machine-readable error type (`invalid_request_error`,
   `rateLimitExceeded`), never its free-text message.
4. **Never put a query string, a header, a request body or a token into a
   message.** Name the host, the path without its query, and the id the
   caller passed.
5. **Let the kit's own errors through unchanged.** `IntegrationRefusedError`
   (with codes such as `host-not-allowed` and `secret-not-declared`) and
   `TimeoutError` are already safe to show. Catching them and retrying, or
   hiding them, is a bug.
6. **Invalid tool arguments** become `bad-arguments`, naming the path of
   each bad field (`maxResults`), never its value.
7. **Never swallow an error** to return an empty result. "No messages" and
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
- **Shared code goes where it belongs:** in the provider's group for one
  provider (`tools/google/auth`), in the kit when every integration needs
  it. Never copy a helper between integrations; propose it for the kit
  instead.
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
  path: every status in the table in section 7, and a body Zod refuses.
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
  names, chat text, model prompts and answers. The recorder never guesses
  these; an undeclared field stays as it was. Paths start at
  `request.body` or `response.body`: `response.body.files[*].name`,
  `response.body.content[*].text`. Add `secretFields` for a field that
  carries a secret under a name that doesn't say so, and
  `allowContentTypes` for a body that isn't JSON, form data or an event
  stream.
- **Read every recording before you commit it,** top to bottom. Any real
  name, address, subject or sentence that survived means a `userContent`
  path is missing: add it and record again. Never edit a recording by
  hand to hide something.
- **Use the fakes in tests:** `example.com` addresses, invented names and
  the kit's fake keys. Never a real account, person or key.

The recorder's README (`tooling/record/README.md`) has the recording
format and the full list of scrub rules.

> **Not settled yet:** the conformance suite is published from the main
> repo as `@halonicjs/testing-integration`, and `pnpm record` is in
> review. Until both are on `main`, test the mapping functions and the
> error paths with your own tests.

## 10. What an integration must never do

This list is the reviewer's checklist, and the Studio assistant checks
every integration it writes against it before it shows the result. An
integration that breaks one of these is refused, whoever wrote it.

1. Reach the network any way other than `host.http`, or call a host its
   sheet doesn't list.
2. Read, hold, log or return a key, token or password value, or ask the
   user to paste one into a setting, a tool argument or a file.
3. Use `eval`, `new Function`, an `import()` with a computed name,
   `node:*` modules, `process`, `globalThis` or the file system. The
   TypeScript preset and `pnpm check` refuse most of these; a reviewer
   refuses the rest.
4. Add an outside library, or copy one in as source code.
5. Declare a tool with a lower `risk` than what it does, or leave out
   `untrusted` when the result holds outside content.
6. Do more than the user asked: no extra recipients, no sharing, no
   deleting, no changes outside the tool's description.
7. Send a request from `connect`. An integration only calls the service
   when a tool or the provider is called.
8. Retry a request that sends or deletes something.
9. Put the service's error text, a query string, a header or user content
   into an error message.
10. Return the service's raw response, or a result without limits.
11. Commit or upload a key, a token or personal data anywhere: code,
    tests, recordings, comments, commit messages or pull request text.
    That includes the names and e-mail addresses of real people.
12. Rename a shipped tool, or change what its arguments mean.
13. Change the checks, the recorder's rules or another integration in
    the same change. Each of those is its own pull request.

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
over everything it adds, plus a review by a person.
