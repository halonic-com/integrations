# @halonicjs/integration-mcp-server

The code for the MCP server the workspace chooses, as tools or as a
knowledge source. A library, not an integration: it has no permission
sheet and exports no `Integration` of its own. It talks to the server
through our own MCP client in [`../mcp`](../mcp/README.md), so it carries
nothing but our code and Zod into the cloud runtime.

- **Layer:** integrations
- **Owner:** ravi

## Why a library

Where the server may be is the permission sheet's business, not the
code's: a `{ fromSetting }` host declares one class, so a server on this
computer (`loopback`) and one online (`public`) need a sheet each. The
code is the same for both, so it lives here once, and each entry package
is this code with its own sheet, name, README and recordings.

| Part               | Folder       | Builds                                                                            |
| ------------------ | ------------ | --------------------------------------------------------------------------------- |
| The server's tools | `tools/`     | `mcpToolsIntegration(entry)`: see [tool-mcp-http](../tools/mcp/http/README.md)    |
| A knowledge source | `knowledge/` | `mcpKnowledgeIntegration(entry)`: see [knowledge-mcp](../knowledge/mcp/README.md) |

`entry` is the sheet's `id` and `version`. The connection introduces itself
to the server as `halonic-<id>`, and a wrong setting's message names the id.

```ts
import { mcpToolsIntegration } from "@halonicjs/integration-mcp-server";

export const mcpHttp = mcpToolsIntegration({ name: "tool-mcp-http", version: "0.1.0" });
```

The behaviour, the limits and the errors are described in the entry
packages' READMEs, because that is where a user of the integration looks.
