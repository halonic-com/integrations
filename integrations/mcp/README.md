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
  `GET` and `Last-Event-ID`, at most 3 times, and only when the server
  gave its events ids. The `retry:` pause is not honoured yet: the kit has
  no timer for integrations.
- No standing `GET` stream for messages outside a request yet, so a
  `tools/list_changed` notice arrives only during a request.

## Still to come (HAL-134)

The permission sheet (`integration.yaml`), the `Integration` with
`listTools`, and the conformance suite follow when the kit is published
(HAL-135).
