# knowledge-mcp-local: MCP server on this computer

A knowledge source on an MCP server that runs on this computer. Agents
search it and read its documents. In the knowledge picker it is **MCP
server on this computer**: "A server running on this computer, for example
http://localhost:8080."

- **Layer:** integrations
- **Owner:** tomas

It is the same code as [knowledge-mcp](../mcp/README.md), the server
online, from the [`mcp-server`](../../mcp-server/README.md) library. Only
the sheet differs: its `{ fromSetting: url }` host is `class: loopback`,
so the trust check can say "only on this computer" before the setting is
filled in. A server elsewhere needs the online entry. A source's `config`,
the hits, documents, errors, requests and limits are as that README says.

## Connecting it

The workspace gives the connection one setting, `url`: the server's MCP
endpoint on this computer, such as `http://localhost:8080/mcp`. The kit
refuses a `url` whose host isn't `localhost`, in `127.0.0.0/8` or `[::1]`
(`setting-outside-class`), so the source sends nothing anywhere else.

Plain `http` is allowed, because the traffic never leaves this computer.
The key (`mcp-server-key`) goes only to that host, as
`Authorization: Bearer`, over `http` too. It is optional: for a server that
needs none, leave it unset, and the kit sends the requests without it.

## Recordings

There is no test server yet, so the recordings in `recordings/` are the
invented traffic of the online entry, sent to `http://localhost:8080/mcp`
and fed through the recorder's `prepareRecording` with this sheet's
`userContent` paths.
