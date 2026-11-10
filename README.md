# Halonic integrations

The integrations for [Halonic](https://github.com/halonic-com/halonic): model
providers, our own MCP client, Google, Gmail, Drive and the knowledge
connectors. Each one is built to the integration interface in the main repo
(`@halonicjs/integration-kit`): a permission sheet, an HTTP client limited to
the hosts and secrets it declares, tool declarations with a risk level, and
the shared conformance suite.

This repository is being set up. More soon.

| Folder                                    | What                                              |
| ----------------------------------------- | ------------------------------------------------- |
| `integrations/models/<provider>`          | model providers, such as Anthropic and OpenAI     |
| `integrations/knowledge/<source>`         | knowledge sources, such as `knowledge/mcp-online` |
| `integrations/tools/<provider>/<service>` | services with tools, such as `tools/google/gmail` |
| `integrations/<name>`                     | integrations in no group, such as our MCP client  |
| `tooling/<name>`                          | the repo's own tools, such as `pnpm record`       |

Each integration has its own permission sheet and recorded responses. See
[docs/guides/integrations.md](docs/guides/integrations.md) for the details.

The tooling, checks and settings match the main repo's. Change them there
first, then here.

## Contributing and licence

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to
set up the repo, what an integration needs and how pull requests are reviewed.

Halonic integrations are licensed under the [Apache License 2.0](LICENSE). See
[NOTICE](NOTICE) for the copyright notice.
