# knowledge-mcp

A knowledge source on any MCP server. Agents search it and read its
documents; the source maps `search` and `get` onto two of the server's
tools. It talks to the server through our own MCP client in
[`../../mcp`](../../mcp/README.md), so it carries nothing but our code and
Zod into the cloud runtime.

- **Layer:** integrations
- **Owner:** tomas

## Connecting it

The workspace gives the connection two settings:

| Setting   | What                                                                                |
| --------- | ----------------------------------------------------------------------------------- |
| `url`     | the server's MCP endpoint, such as `https://docs.example.com/mcp`. Required         |
| `sendKey` | `false` for a server that needs no key. Default `true`: the key goes with each call |

The sheet allows the host of `url` and nothing else, and the key
(`mcp-server-key`) goes only to that host, as `Authorization: Bearer`.
The integration names the key and never sees it.

Each knowledge source names the server's tools in its `config`:

| Config       | What                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| `searchTool` | the tool that searches. Required                                       |
| `queryArg`   | the search tool's argument for the query. Default `query`              |
| `getTool`    | the tool that reads one document. Without it, `get` always says `null` |
| `refArg`     | the get tool's argument for the document's ref. Default `ref`          |

`url`, `secret` and `headers` in a source's config are ignored: the host
comes from the setting, the key from the sheet, and no header from config
is ever sent.

## Differences from the old Studio source

The old `packages/knowledge/mcp` took shortcuts this version doesn't:

- **Real hits.** The old `search` returned one made-up hit holding the
  whole tool text. Now a structured answer (JSON) becomes one hit per
  result, best first. Plain text still becomes one hit, cut to a limit.
- **Limits on everything** the server sends: the number of hits, the
  length of each snippet and title, and the size of a document.
- **Untrusted.** Every hit and document is the server's text; the sheet
  says so, and Halonic fences it off.
- **One host, from a setting.** The key goes only to the server the
  workspace chose. Arbitrary `headers` from config are no longer sent.
- **Our errors.** `KnowledgeMcpError` with a `code`; never the server's
  own text.

## Still to come (HAL-346)

The result mapping and its limits, then the knowledge provider with its
recordings, follow in the next two pull requests.
