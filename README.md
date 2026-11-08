# Halonic integrations

The integrations for [Halonic](https://github.com/halonic-com/halonic): model
providers, our own MCP client, Google, Gmail, Drive and the knowledge
connectors. Each one is built to the integration interface in the main repo
(`@halonicjs/integration-kit`): a permission sheet, an HTTP client limited to
the hosts and secrets it declares, tool declarations with a risk level, and
the shared conformance suite.

This repository is being set up. More soon.

| Folder                | What                                                             |
| --------------------- | ---------------------------------------------------------------- |
| `integrations/<name>` | one integration, its permission sheet and its recorded responses |
| `tooling/<name>`      | the repo's own tools, such as `pnpm record`                      |

The tooling, checks and settings match the main repo's. Change them there
first, then here.
