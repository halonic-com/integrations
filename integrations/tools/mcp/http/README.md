# tool-mcp-http

Tools from any MCP server the workspace chooses, offered to agents. It
talks to the server over streamable HTTP through our own MCP client in
[`../../../mcp`](../../../mcp/README.md), so it carries nothing but our
code and Zod into the cloud runtime.

- **Layer:** integrations
- **Owner:** ravi

It replaces the old Studio's `packages/mcp/connector` for servers over
HTTP. A server that runs as a local program (stdio) is a matter for the
host, and comes with connector pinning in phase 3.

## Where it sits and what it's called

The guide puts a service with tools in `tools/<provider>/<service>/`. MCP
is no provider, but it is the closest fit: `tools/mcp/http/`, so
`tool-mcp-http`. A local-program variant would be `tools/mcp/stdio/`, with
its own sheet, because it needs `process` instead of a host.

## Connecting it

The workspace gives the connection one setting, `url`: the server's MCP
endpoint, such as `https://tools.example.com/mcp`.

The sheet allows the host of `url` and nothing else, and the key
(`mcp-server-key`) goes only to that host, as `Authorization: Bearer`.
The integration names the key and never sees it. The key is optional in
the sheet: for a server that needs none, leave it unset, and the kit sends
the requests without it. A server that needs one and gets none answers
`401`, which reaches the user as `not-signed-in`.

## Tools

The sheet declares no tools: the server decides them, and may change
them while connected. The connection's `listTools` asks the server each
time, so a changed list shows up on the next call. Each tool keeps the
server's name, description and argument schema, and gets:

- **`risk: "write"`**, whatever the server says. Halonic treats a tool that
  isn't in the sheet as `write` anyway, unless the workspace sets a lower
  risk. The server's own hints (`readOnlyHint` and the others) never lower
  it: a server can claim anything.
- **`untrusted: true`**: every result is the server's text, and Halonic
  fences it off so instructions in it aren't followed.

The descriptions, the tool's own and those inside its argument schema, are
the server's text too, but `untrusted` covers results only: Halonic gives
the model the tool list unfenced. We can't stop a server from writing
instructions into a description. We take out what a person reading the
list can't see, so nothing is hidden there: format characters (zero-width
characters, direction marks, invisible tag letters) and control characters
other than line breaks and tabs.

A list that repeats a tool's name is refused: the model would see one tool
while a call reached the other.

## Results and errors

A tool's result is the text the server returned. A part that isn't text,
such as an image, is named in a short note instead. A tool that reports
its own failure (`isError`) fails the call with `tool-failed`; the
server's text never goes into our message, because errors aren't fenced
off like results.

Errors are `McpToolsError` with the MCP client's codes, plus `bad-config`
for a wrong `url` and `tool-failed`. The kit's own errors, its timeout and
a cancelled call pass through unchanged.

## Requests

The integration opens the MCP session on the first call, never in
`connect`. Calls that come in together share it, and a session the server
ends is replaced on the next call; the failed call itself is never
repeated. Each tool call is one request and each tool list at most ten,
plus the two of the handshake on the first call. A cancelled call tells
the server with `notifications/cancelled`. `close` ends the session on the
server.

## Limits

| What                            | Limit                                                                   |
| ------------------------------- | ----------------------------------------------------------------------- |
| tools per server                | 200, in at most 10 pages; more is refused, not cut                      |
| a tool's description            | 2,000 characters                                                        |
| a tool's argument schema (JSON) | 20,000 characters; a larger one is refused, not cut                     |
| the whole tool list             | 200,000 characters of descriptions and schemas; a larger one is refused |
| a tool's result                 | 50,000 characters, about 12,000 tokens                                  |

Text that is cut ends with `…`, never in the middle of a character. A
refused list names the tool, never the server's text.

One tool over its limit refuses the whole list, as too many tools do, on
purpose: an agent sees the server's tools as the server offers them, or
none, and the user sees why. Leaving tools out quietly would make the
agent miss a tool nobody knows is gone.

## Recordings

There is no test server yet, so the recordings in `recordings/` are
invented traffic with a small made-up notes server, fed through the
recorder's `prepareRecording` with this sheet's `userContent` paths. They
show listing tools, a call answered as an event stream, a tool error, a
server that changes its tools, a missing key and a cancelled call.
