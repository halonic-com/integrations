# @halonicjs/integration-mcp

Our own client for the Model Context Protocol
([specification](https://modelcontextprotocol.io/specification/2025-11-25)).
We write it ourselves instead of using an MCP library, so it carries
nothing but our code and Zod into the cloud runtime.

- **Layer:** integrations
- **Owner:** ravi

## What it does so far

| Part          | File                | What                                                                                     |
| ------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| JSON-RPC 2.0  | `json-rpc.ts`       | the messages, and sorting what the server sends into requests, notifications and answers |
| MCP results   | `protocol.ts`       | the versions we speak and Zod schemas for `initialize`, `tools/list`, `tools/call`       |
| The session   | `session.ts`        | the handshake, id matching, paged `tools/list` and `tools/call`                          |
| The client    | `client.ts`         | one integration's link to one server: a session opened on first use and after it ends    |
| The transport | `transport.ts`      | how the session sends messages                                                           |
| HTTP          | `http-transport.ts` | the streamable HTTP transport: `Mcp-Session-Id`, JSON and event-stream answers, resume   |
| Errors        | `errors.ts`         | `McpError` with a `code`; never the server's own text                                    |

Tools only for v0.1. Resources, prompts, sampling and OAuth come later
(migration checklist K12). The client declares no capabilities, answers the
server's `ping` and refuses every other request from the server.

### Limits

- `tools/list`: at most 10 pages and 200 tools; more is refused rather
  than cut off silently.
- Tool names must follow the specification (`A-Z a-z 0-9 _ . -`, up to 128
  characters). A server's annotations are read but are hints only: they
  never lower a tool's risk on their own.
- `tools/call` is never retried, because a tool can send or delete.
- An answer stream that ends or drops before the answer is resumed with a
  `GET` and `Last-Event-ID`, only when the server gave its events ids. It
  gives up after 3 resumes in a row that brought no new event, so a long
  call the server closes on purpose keeps going, and after 10 resumes in
  all, even when each brought a new event. Before each resume it waits
  with `host.wait` as long as the server's `retry:` asks, at least 1 s
  and at most 30 s, the host's limit.
- No standing `GET` stream for messages outside a request yet, so a
  `tools/list_changed` notice arrives only during a request.

## Using it in an integration

An integration builds one `McpClient` per connection and never sends a
request in `connect`. The client opens the session on the first call, lets
calls that come in together share it, and opens a new one after the server
ended it; the failed call itself is never repeated. `checkAgreement` can
refuse a server, such as one that offers no tools.

```ts
const client = new McpClient({
  clientInfo: { name: "halonic-tool-mcp-http-online", version: "0.1.0" },
  openTransport: () => new StreamableHttpTransport(host, { url, auth }),
});
const tools = await client.listTools(signal);
```
