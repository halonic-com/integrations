# Integration examples

Three worked examples of the rules in [integrations.md](integrations.md):
Gmail (tools that read and send), Drive (tools that read files and change
them) and Anthropic (a model provider). They show the shape of each part,
not every tool: the real integrations have more tools and more tests.

Code imports the interface types and the tool helper from
`@halonicjs/integration-kit`, and the Google request helper from the Google
group's shared library, `@halonicjs/integration-tool-google-shared`.

> **Not settled yet:** the kit is published from the main repo, and the
> Google sign-in is still to be built in Halonic itself. Until it is,
> `googleApi(host, { secret, service })` with `getJson`, `postJson` and
> `GoogleError(code, message)` is the shape the examples assume for
> `tools/google/shared`. Names in these examples follow the integration
> interface decision and may change in small ways when those land. The
> structure stays.

## What the kit gives you

Every integration with tools ties each tool's declaration, argument schema
and `run` function together the same way, so the kit holds that code once.
It is small enough to read in one go:

```ts
// in @halonicjs/integration-kit
import type { z } from "zod";

/** One tool: what the model sees, how its arguments are checked, and what runs. */
export interface ToolImplementation<Client, Arguments extends z.ZodType = z.ZodType> {
  readonly declaration: IntegrationTool;
  readonly arguments: Arguments;
  // Method syntax on purpose: it lets a list hold tools with different arguments.
  run(client: Client, args: z.infer<Arguments>, signal?: AbortSignal): Promise<unknown>;
}

/** Builds the integration's error for a refused call; see section 7 of the guide. */
export type MakeError = (code: "bad-arguments" | "not-found", message: string) => Error;

/** A tool name the model made up is repeated only this far. */
const maxEchoedNameLength = 64;

/**
 * Finds the tool, checks its arguments and runs it. The result is the
 * tool's own small object as JSON, never the service's raw response.
 */
export async function runTool<Client>(
  tools: readonly ToolImplementation<Client>[],
  client: Client,
  call: { name: string; args: Record<string, unknown>; signal?: AbortSignal | undefined },
  makeError: MakeError,
): Promise<string> {
  const tool = tools.find((candidate) => candidate.declaration.name === call.name);
  if (tool === undefined) {
    const name = call.name.slice(0, maxEchoedNameLength);
    throw makeError("not-found", `There is no tool named ${name}.`);
  }
  const parsed = tool.arguments.safeParse(call.args);
  if (!parsed.success) {
    // Name the bad fields, never their values: they may hold the user's content.
    const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(arguments)");
    throw makeError("bad-arguments", `Check these arguments: ${[...new Set(fields)].join(", ")}.`);
  }
  return JSON.stringify(await tool.run(client, parsed.data, call.signal));
}
```

> **Not settled yet:** `ToolImplementation` and `runTool` are being added
> to the kit. Until they are published, the code above is what they do.

## 1. Gmail (`tool-google-gmail`)

```
integrations/tools/google/gmail/
├─ integration.yaml
├─ README.md
├─ src/index.ts            the Integration
├─ src/client.ts           GmailClient: every Gmail request and its Zod schema
├─ src/mime.ts             builds and encodes an outgoing message
├─ src/tools/search.ts     gmail_search
├─ src/tools/send.ts       gmail_send
├─ src/tools/*.test.ts
└─ recordings/             search-two-pages.json, send.json, send-refused.json
```

### The permission sheet

```yaml
id: tool-google-gmail
version: 1.0.0
kit: 1
provides: [connector]

hosts:
  - gmail.googleapis.com

secrets:
  google-account:
    purpose: Access to the Google account you connect, through the Google sign-in.
    hosts: [gmail.googleapis.com]
    as: bearer

tokens: [] # Halonic's Google sign-in keeps the refresh token, not Gmail

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
    untrusted: true # senders, subjects and snippets are written by other people
  - name: gmail_send
    description: >-
      Sends an e-mail from the account. Sending can't be undone; prefer
      gmail_create_draft when a person should check it first.
    arguments:
      to: Recipient addresses, such as "someone@example.com".
      body: Plain-text body.
    risk: send
    untrusted: false # returns only ids

needs: []

recording:
  userContent:
    - response.body.snippet # a message's opening words
    - response.body.payload.headers[*].value # Subject, From, To, Date
    - request.query.q # the search, in the URL's query string
    - request.body.raw # the whole outgoing message
```

The `From` and `To` values are scrubbed as content too. The recorder would
replace their e-mail addresses anyway, but not the names next to them.

The search query travels in the URL (`?q=…`), so the sheet declares it as
`request.query.q`. A scenario that doesn't search, such as sending, lists
that path in its `unusedUserContent`, and a read-only scenario lists
`request.body.raw`.

### The client

All Gmail requests go through one class. The Google group's shared
`googleApi` adds the account's access token, retries safe requests and maps
Google's status codes to `GoogleError`, so Gmail doesn't repeat any of it.

```ts
// src/client.ts
import { googleApi, type GoogleApi } from "@halonicjs/integration-tool-google-shared";
import type { IntegrationHost } from "@halonicjs/integration-kit";
import { z } from "zod";

const gmailBase = "https://gmail.googleapis.com/gmail/v1/users/me/";

/** Only the fields we read. Gmail adds fields over time; they pass through unchecked. */
const messageListSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).default([]),
  nextPageToken: z.string().optional(),
});

const messageMetadataSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  snippet: z.string().default(""),
  labelIds: z.array(z.string()).default([]),
  payload: z.object({
    headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  }),
});
export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

const sentMessageSchema = z.object({ id: z.string(), threadId: z.string() });

export class GmailClient {
  readonly #google: GoogleApi;

  constructor(host: IntegrationHost) {
    this.#google = googleApi(host, { secret: "google-account", service: "Gmail" });
  }

  async listMessageIds(
    query: string,
    maxResults: number,
    pageToken: string | undefined,
    signal?: AbortSignal,
  ) {
    const url = new URL("messages", gmailBase);
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", String(maxResults));
    if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
    return await this.#google.getJson(url.href, messageListSchema, signal);
  }

  async getMessageMetadata(messageId: string, signal?: AbortSignal): Promise<MessageMetadata> {
    // encodeURIComponent: an id must never change the path.
    const url = new URL(`messages/${encodeURIComponent(messageId)}`, gmailBase);
    url.searchParams.set("format", "metadata");
    for (const header of ["From", "To", "Subject", "Date"]) {
      url.searchParams.append("metadataHeaders", header);
    }
    return await this.#google.getJson(url.href, messageMetadataSchema, signal);
  }

  /** Sends once. `postJson` never retries a POST, so a timeout can't send the mail twice. */
  async sendRawMessage(raw: string, signal?: AbortSignal) {
    const url = new URL("messages/send", gmailBase);
    return await this.#google.postJson(url.href, { raw }, sentMessageSchema, signal);
  }
}
```

### A read tool: `gmail_search`

```ts
// src/tools/search.ts
import { z } from "zod";
import type { ToolImplementation } from "@halonicjs/integration-kit";
import type { GmailClient, MessageMetadata } from "../client.ts";

const searchArguments = z.strictObject({
  query: z
    .string()
    .max(500)
    .default("in:inbox")
    .describe('Gmail search query, such as "from:billing is:unread newer_than:7d".'),
  maxResults: z.int().min(1).max(25).default(10),
  pageToken: z
    .string()
    .max(500)
    .optional()
    .describe("nextPageToken from the previous search, for more results."),
});

/** What the tool promises in its description, and nothing more. */
interface SearchResult {
  messages: {
    id: string;
    threadId: string;
    from: string;
    subject: string;
    date: string;
    snippet: string;
  }[];
  nextPageToken?: string;
}

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
  // At most 26 requests: one list, then one per message (maxResults is at most 25).
  async run(client, args, signal) {
    const list = await client.listMessageIds(args.query, args.maxResults, args.pageToken, signal);
    const messages = await Promise.all(
      list.messages.map((message) => client.getMessageMetadata(message.id, signal)),
    );
    const result: SearchResult = { messages: messages.map(toSearchEntry) };
    if (list.nextPageToken !== undefined) result.nextPageToken = list.nextPageToken;
    return result;
  },
} satisfies ToolImplementation<GmailClient, typeof searchArguments>;

function toSearchEntry(message: MessageMetadata): SearchResult["messages"][number] {
  const header = (name: string) =>
    message.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  return {
    id: message.id,
    threadId: message.threadId,
    from: header("From"),
    subject: header("Subject"),
    date: header("Date"),
    snippet: message.snippet,
  };
}
```

### A send tool: `gmail_send`

```ts
// src/tools/send.ts
const address = z.email().max(320);

const sendArguments = z.strictObject({
  to: z
    .array(address)
    .min(1)
    .max(50)
    .describe('Recipient addresses, such as "someone@example.com".'),
  cc: z.array(address).max(50).default([]),
  subject: z.string().max(998),
  body: z.string().max(100_000).describe("Plain-text body."),
});

export const sendTool = {
  declaration: {
    name: "gmail_send",
    description:
      "Sends an e-mail from the account. Sending can't be undone; prefer gmail_create_draft when a person should check it first.",
    parameters: z.toJSONSchema(sendArguments, { io: "input" }),
    risk: "send",
    untrusted: false,
  },
  arguments: sendArguments,
  async run(client, args, signal) {
    // Only the recipients the caller named: never add anyone, never Bcc.
    const raw = encodeMessage({ to: args.to, cc: args.cc, subject: args.subject, body: args.body });
    const sent = await client.sendRawMessage(raw, signal);
    return { id: sent.id, threadId: sent.threadId };
  },
} satisfies ToolImplementation<GmailClient, typeof sendArguments>;
```

`encodeMessage` in `src/mime.ts` builds the message (headers encoded so a
subject can't add a header line) and encodes it as base64url. It has its
own tests, including a subject with a line break in it.

### The integration

```ts
// src/index.ts
import { type Integration, runTool } from "@halonicjs/integration-kit";
import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { GmailClient } from "./client.ts";
import { searchTool } from "./tools/search.ts";
import { sendTool } from "./tools/send.ts";

/** The same tools, in the same order, as in integration.yaml. */
const tools = [searchTool, sendTool];

export const gmail: Integration = {
  name: "tool-google-gmail",
  version: "1.0.0",
  tools: tools.map((tool) => tool.declaration),
  connect(host) {
    // No request here: Gmail is only called when a tool is.
    const client = new GmailClient(host);
    return {
      callTool: (name, args, signal) =>
        runTool(
          tools,
          client,
          { name, args, signal },
          (code, message) => new GoogleError(code, message),
        ),
      close: async () => {},
    };
  },
};
```

### Why it looks like this

- `gmail_search` is `read` and `untrusted`: it changes nothing, and
  everything it returns was written by someone else.
- `gmail_send` is `send`: it reaches people outside the account. It isn't
  `untrusted`, because it only returns ids.
- The search returns a snippet, not whole bodies, so 25 results stay small.
- `send-refused.json` records a `400` from Gmail. The shared `googleApi`
  turns it into `GoogleError("bad-arguments", …)`, and the test proves the
  message holds no part of the mail: no address, subject or body text.
  ("Check these arguments" is `runTool`'s message for arguments Zod
  refuses, before any request is made.)

## 2. Drive (`tool-google-drive`)

```
integrations/tools/google/drive/
├─ integration.yaml
├─ src/index.ts  src/client.ts
├─ src/tools/read-file.ts    drive_read_file
├─ src/tools/create-folder.ts drive_create_folder
└─ recordings/               read-document.json, read-binary.json, create-folder.json
```

### The permission sheet

```yaml
id: tool-google-drive
version: 1.0.0
kit: 1
provides: [connector]

hosts:
  - www.googleapis.com # Drive API v3 and its uploads both live here

secrets:
  google-account:
    purpose: Access to the Google account you connect, through the Google sign-in.
    hosts: [www.googleapis.com]
    as: bearer

tokens: []

tools:
  - name: drive_read_file
    description: >-
      Returns a file's contents as text: Google Docs as Markdown, Sheets as
      CSV (first sheet), Slides as text, text files as they are. For other
      files, such as PDFs and images, it returns only their details.
    arguments:
      offset: Where to start; use nextOffset from the previous read.
    risk: read
    untrusted: true # shared files are written by other people
  - name: drive_create_folder
    description: >-
      Creates a folder at the top of the user's own My Drive, where only
      they can see it. Returns its id and link.
    risk: write
    untrusted: false # returns the folder's id, the name it was given and a link

needs: []

recording:
  userContent:
    - response.body.name # file and folder names can be personal
    - request.body.name
  # Google Docs export as Markdown, Sheets as CSV and Slides as plain text.
  allowContentTypes: [text/markdown, text/csv, text/plain]
```

Text bodies have no fields, so the recorder can't remove content from them
by path, and a download's `Content-Disposition` header carries the file
name, which paths can't reach yet. Record `read-document.json` and
`read-binary.json` against test files with names and text you made up
yourself, and check both when you read the recordings.

### A read tool: `drive_read_file`

```ts
// src/tools/read-file.ts
const readFileArguments = z.strictObject({
  fileId: z.string().min(1).max(200),
  maxChars: z.int().min(500).max(60_000).default(20_000),
  offset: z
    .int()
    .min(0)
    .default(0)
    .describe("Where to start; use nextOffset from the previous read."),
});

export const readFileTool = {
  declaration: {
    name: "drive_read_file",
    description:
      "Returns a file's contents as text: Google Docs as Markdown, Sheets as CSV (first sheet), Slides as text, text files as they are. For other files, such as PDFs and images, it returns only their details.",
    parameters: z.toJSONSchema(readFileArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: readFileArguments,
  // At most 2 requests: the file's details, then its export or download.
  async run(client, args, signal) {
    const file = await client.getFile(args.fileId, signal);
    const text = await readAsText(client, file, signal);
    if (text === undefined) {
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        content: null,
        note: "Not a text file: only its details are returned.",
      };
    }
    const end = args.offset + args.maxChars;
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      content: text.slice(args.offset, end),
      ...(end < text.length ? { nextOffset: end } : {}),
    };
  },
} satisfies ToolImplementation<DriveClient, typeof readFileArguments>;

/**
 * Which text type each Google file type exports to. A Map, not a plain
 * object: a file's mimeType is set by whoever uploaded it, and a value such
 * as "constructor" would find a function in a plain object.
 */
const exportTypes: ReadonlyMap<string, string> = new Map([
  ["application/vnd.google-apps.document", "text/markdown"],
  ["application/vnd.google-apps.spreadsheet", "text/csv"],
  ["application/vnd.google-apps.presentation", "text/plain"],
]);

/** Google files are exported; text files are downloaded; anything else has no text. */
async function readAsText(
  client: DriveClient,
  file: DriveFile,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const exportType = exportTypes.get(file.mimeType);
  if (exportType !== undefined) return await client.exportFile(file.id, exportType, signal);
  if (file.mimeType.startsWith("text/")) return await client.downloadText(file.id, signal);
  return undefined;
}
```

The client's `exportFile` calls
`GET /drive/v3/files/{fileId}/export?mimeType=…` and `downloadText` calls
`GET /drive/v3/files/{fileId}?alt=media`, both through the shared
`googleApi`, with the file id encoded. Drive exports stop at 10 MB, the
same as the kit's response limit.

### A write tool: `drive_create_folder`

```ts
// src/tools/create-folder.ts
const createFolderArguments = z.strictObject({
  name: z.string().min(1).max(255),
});

export const createFolderTool = {
  declaration: {
    name: "drive_create_folder",
    description:
      "Creates a folder at the top of the user's own My Drive, where only they can see it. Returns its id and link.",
    parameters: z.toJSONSchema(createFolderArguments, { io: "input" }),
    risk: "write",
    untrusted: false,
  },
  arguments: createFolderArguments,
  // 1 request. No parent folder on purpose: see "Why it looks like this".
  async run(client, args, signal) {
    const folder = await client.createFolderInMyDrive(args.name, signal);
    return { id: folder.id, name: folder.name, link: folder.webViewLink };
  },
} satisfies ToolImplementation<DriveClient, typeof createFolderArguments>;
```

### Why it looks like this

- `drive_create_folder` is `write` because it can only create at the top
  of My Drive, which is never shared. A folder the caller names could be
  shared with other people, or sit in a shared drive, and then creating
  something in it puts content where they can see it. So a tool that takes
  a parent folder is `send`, unless it checks that the folder isn't shared
  and refuses when it is. A `drive_share_file` tool is `send` too, and so
  is creating a public link.
- `drive_read_file` returns at most `maxChars` and a `nextOffset`, so a
  long document is read in parts instead of filling the model's context.
- Binary files return their details and a note, not an error: "not text" is
  a normal answer, and the description says so.
- A "move to trash" tool would be `write`. Deleting for good isn't offered.

## 3. A model provider: Anthropic (`model-anthropic`)

```
integrations/models/anthropic/
├─ integration.yaml
├─ src/index.ts           the Integration
├─ src/provider.ts        the LlmProvider: one request per chat call
├─ src/to-request.ts      ChatRequest → Anthropic request
├─ src/from-response.ts   Anthropic response → ChatResponse, with its Zod schema
├─ src/errors.ts          AnthropicError and the status mapping
├─ src/*.test.ts
└─ recordings/            answer-text.json, tool-call.json, key-refused.json, overloaded.json
```

### The permission sheet

```yaml
id: model-anthropic
version: 1.0.0
kit: 1
provides: [llm]

hosts:
  - api.anthropic.com

secrets:
  anthropic-key:
    purpose: Your Anthropic API key. Sent to Anthropic with every model call.
    hosts: [api.anthropic.com]
    as: header
    header: x-api-key

tokens: []
tools: []
needs: []

limits:
  # Without streaming, the Messages API sends its response headers only once
  # the whole answer is done, so a long answer would hit the default 30 s
  # headers timeout. Allow it the full 10 minutes the kit allows overall.
  # The field name follows the kit and may still change in the sheet.
  headersTimeoutMs: 600000

recording:
  userContent:
    - request.body.system
    - request.body.messages[*].content[*].text # what the user and the model wrote
    - request.body.messages[*].content[*].content # tool results sent back
    - request.body.messages[*].content[*].input # tool arguments sent back, nested values too
    - response.body.content[*].text
    - response.body.content[*].thinking # the model's reasoning about the user's content
    - response.body.content[*].input
```

A workspace that sends its model calls through its own gateway would need
`{ fromSetting: baseUrl }` in `hosts`. Leave it out until someone needs it:
every host in the sheet is one more place a key may go.

### The provider

```ts
// src/provider.ts
import type {
  ChatRequest,
  ChatResponse,
  IntegrationHost,
  LlmProvider,
  ProviderConfig,
} from "@halonicjs/integration-kit";
import { AnthropicError, errorForResponse } from "./errors.ts";
import { anthropicResponseSchema, fromAnthropicResponse } from "./from-response.ts";
import { toAnthropicRequest } from "./to-request.ts";

const messagesUrl = "https://api.anthropic.com/v1/messages";
/** The API version this integration's mapping is written for. */
const apiVersion = "2023-06-01";

export function createAnthropicProvider(
  host: IntegrationHost,
  config: ProviderConfig,
): LlmProvider {
  return {
    id: config.id,
    type: "anthropic",
    // Only what the mapping below handles. Images, JSON answers and
    // streaming come with the code that supports them.
    capabilities: { tools: true, jsonOutput: false, vision: false, streaming: false },
    chat: (request) => chat(host, request),
  };
}

async function chat(host: IntegrationHost, request: ChatRequest): Promise<ChatResponse> {
  const response = await host.http.fetch(messagesUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": apiVersion },
    body: JSON.stringify(toAnthropicRequest(request)),
    auth: { secret: "anthropic-key", as: "header", header: "x-api-key" },
    signal: request.signal ?? null,
  });
  if (!response.ok) {
    throw await errorForResponse(response);
  }
  const body = anthropicResponseSchema.safeParse(await response.json().catch(() => undefined));
  if (!body.success) {
    throw new AnthropicError("unexpected-response", "Anthropic answered in an unexpected way.");
  }
  return fromAnthropicResponse(body.data);
}
```

### The mapping, both ways

```ts
// src/to-request.ts
/** Used when the workflow sets no limit. High, because a cut-off answer has to be asked again. */
const defaultMaxTokens = 16_000;

export function toAnthropicRequest(request: ChatRequest): AnthropicRequest {
  const system = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content);
  return {
    model: request.model,
    max_tokens: request.params?.maxTokens ?? defaultMaxTokens,
    messages: request.messages.flatMap(toAnthropicMessage),
    ...(system.length > 0 ? { system: system.join("\n\n") } : {}),
    ...(request.tools?.length ? { tools: request.tools.map(toAnthropicTool) } : {}),
    ...(request.params?.stop?.length ? { stop_sequences: request.params.stop } : {}),
    // temperature and topP aren't mapped yet; ChatParams lets a provider
    // ignore what it doesn't support. `meta` is never sent.
  };
}

function toAnthropicMessage(message: ChatMessage): AnthropicMessage[] {
  switch (message.role) {
    case "system":
      return []; // sent as `system` above
    case "user":
      return [{ role: "user", content: [{ type: "text", text: message.content }] }];
    case "assistant":
      return [
        {
          role: "assistant",
          content: [
            ...textBlock(message.content),
            ...(message.toolCalls ?? []).map(toToolUseBlock),
          ],
        },
      ];
    case "tool":
      // Anthropic joins consecutive user messages, so several results in a row are fine.
      return [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: message.toolCallId, content: message.content },
          ],
        },
      ];
  }
}
```

```ts
// src/from-response.ts
const textBlockSchema = z.object({ type: z.literal("text"), text: z.string() });
const toolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
/** Thinking and any block type added later: skipped, never a crash. */
const otherBlockSchema = z.object({ type: z.string() });

export const anthropicResponseSchema = z.object({
  content: z.array(z.union([textBlockSchema, toolUseBlockSchema, otherBlockSchema])),
  stop_reason: z.string().nullable(),
  usage: z.object({ input_tokens: z.int(), output_tokens: z.int() }),
});

/**
 * Every other reason (`refusal`, `pause_turn`, ones added later) is "other".
 * A Map, not a plain object: the reason comes from the service, and a value
 * such as "constructor" would find a function in a plain object.
 */
const finishReasons: ReadonlyMap<string, ChatResponse["finishReason"]> = new Map([
  ["end_turn", "stop"],
  ["stop_sequence", "stop"],
  ["tool_use", "tool_calls"],
  ["max_tokens", "length"],
]);

export function fromAnthropicResponse(body: z.infer<typeof anthropicResponseSchema>): ChatResponse {
  const text = body.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("");
  const toolCalls = body.content
    .filter(isToolUseBlock)
    .map((block) => ({ id: block.id, name: block.name, arguments: block.input }));
  return {
    content: text,
    toolCalls,
    usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens },
    finishReason: finishReasons.get(body.stop_reason ?? "") ?? "other",
  };
}
```

### Errors

```ts
// src/errors.ts
export type AnthropicErrorCode =
  | "bad-arguments"
  | "not-signed-in"
  | "not-allowed"
  | "not-found"
  | "rate-limited"
  | "unavailable"
  | "unexpected-response";

export class AnthropicError extends Error {
  override readonly name = "AnthropicError";
  readonly code: AnthropicErrorCode;

  constructor(code: AnthropicErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Anthropic's error body: `{ type: "error", error: { type, message } }`. We
 * read only `error.type`, and only when it looks like a type name, because
 * whatever we put in the message reaches the model.
 */
const errorBodySchema = z.object({
  error: z.object({ type: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/i) }),
});

const messages: Readonly<Record<AnthropicErrorCode, string>> = {
  "bad-arguments": "Anthropic refused the request as invalid",
  "not-signed-in": "Anthropic refused the key. Check the Anthropic key in Settings",
  "not-allowed": "This key may not use this model or feature",
  "not-found": "Anthropic doesn't know this model. Check the model name",
  "rate-limited": "Anthropic is limiting requests. Try again in a moment",
  unavailable: "Anthropic is having trouble right now. Try again later",
  "unexpected-response": "Anthropic answered in an unexpected way",
};

export async function errorForResponse(response: Response): Promise<AnthropicError> {
  const code = codeForStatus(response.status);
  // A body that isn't JSON is no error of ours: the status alone says enough.
  const body = errorBodySchema.safeParse(await response.json().catch(() => undefined));
  // Never `error.message`: it can repeat parts of the request, such as the prompt.
  const detail = body.success ? ` (${body.data.error.type})` : "";
  return new AnthropicError(code, `${messages[code]}${detail}.`);
}

function codeForStatus(status: number): AnthropicErrorCode {
  if (status === 400 || status === 413 || status === 422) return "bad-arguments";
  if (status === 401) return "not-signed-in";
  if (status === 403) return "not-allowed";
  if (status === 404) return "not-found";
  if (status === 408 || status === 429) return "rate-limited";
  return "unavailable"; // 500, 529 (overloaded) and anything else
}
```

### The integration

```ts
// src/index.ts
export const anthropic: Integration = {
  name: "model-anthropic",
  version: "1.0.0",
  tools: [],
  connect(host) {
    return {
      callTool: async () => {
        throw new AnthropicError("not-found", "model-anthropic has no tools.");
      },
      createLlmProvider: (config) => createAnthropicProvider(host, config),
      close: async () => {},
    };
  },
};
```

### Why it looks like this

- The key is placed by the kit as `x-api-key`; the code only names
  `anthropic-key`. `config.secret` and `config.baseUrl` are ignored, because
  Halonic has already mapped them onto the sheet.
- The sheet raises only the headers timeout, and says why. The body and
  overall limits already fit one answer.
- No retries: a model call costs money and can run for minutes, so the
  workflow decides whether to try again. `overloaded.json` records a `529`
  and the test checks the error is `unavailable`.
- `to-request.ts` and `from-response.ts` are pure functions with their own
  tests: system messages, tool calls in both directions, an unknown block
  type, and every finish reason.
- `jsonOutput`, `vision` and `streaming` are `false` until the mapping
  supports them. Claiming them early would make workflows fail at run time
  instead of when they are checked.
