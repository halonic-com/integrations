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
- **Honest capabilities.** `semantic` is `false`: the source can't know
  how the server searches.
- **Our errors.** `KnowledgeMcpError` with a `code`; never the server's
  own text.

## Reading the server's answers

There is no standard for search results over MCP, so the source reads the
common shapes (`hits.ts`, `document.ts`):

- **Search:** a JSON list of results, a JSON object with the list under
  `results`, `hits`, `documents` or `items`, or one JSON result per text
  part. Each result needs a ref (`ref`, `id`, `uri` or `url`); its title is
  `title` or `name`, its snippet `snippet`, `summary`, `text`, `content` or
  `description`, and its `score` is kept when it is a number. Hits keep the
  server's order. Any other answer is plain text and becomes one hit,
  `<source>:search`, that holds it all.
- **Get:** a JSON object with `content`, `text` or `body` (and `title` or
  `name`), or else the whole text. The ref is always the caller's.

## Limits

| What                | Limit                                        |
| ------------------- | -------------------------------------------- |
| hits per search     | 5 by default, at most 20, whatever is asked  |
| snippet             | 500 characters                               |
| a plain-text answer | 2,000 characters, in its one hit             |
| title               | 200 characters                               |
| ref                 | 1,000 characters; longer refs aren't results |
| document            | 100,000 characters, with a note when cut     |

A query or a ref longer than 1,000 characters is refused before any
request. Text that is cut ends with `…`, never in the middle of a character.

## Requests

The source opens the MCP session on the first search or read, never in
`connect`, and all sources of one connection share it. Each `search` and
`get` is one tool call; the first also sends the two requests of the
handshake. A session that fails to open or that the server ends is
dropped, and the next call opens a new one. The failed call itself is
never repeated. `close` ends the session on the server.

## Recordings

There is no test server yet, so the recordings in `recordings/` are
invented MCP traffic fed through the recorder's `prepareRecording` with
this sheet's `userContent` paths. They are scrubbed as a real recording
would be, which also tests the paths.
