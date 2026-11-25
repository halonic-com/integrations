# Rules for agents in this repo

This repo is public. Everything you commit, comment or upload here is
published permanently.

## Before you start

- Read [docs/guides/integrations.md](docs/guides/integrations.md) before
  you write or change an integration.
- Run `pnpm verify` before you ask for review. What each check does is in
  [docs/guides/checks.md](docs/guides/checks.md).

## Always

- Work on a branch and land it as a small pull request. Never push to
  `main`.
- Commit as `halonic-dev` with its GitHub noreply address. No sign-off
  line is needed.
- Use a conventional pull request title, such as `feat(gmail): add
  sending`; it becomes the squash commit message.
- Prefer readable code over short code, and add an abstraction where it
  helps the reader.
- When a Google tool under `integrations/tools/google/` gets a risk other
  than `read` (a new tool, or a changed risk), also open a pull request in
  `halonic` that updates `googleAskFirstTools` in `@halonicjs/format`. It
  is the readable list of tools that ask first. Nothing breaks if you
  forget, because the run-time risk check still asks first, but the list
  would be incomplete.
- When you change `docs/guides/integrations.md`, also open a pull request
  in `halonic` that refreshes the Assistant's pinned copy of the guide
  with `pnpm --filter @halonicjs/assistant run update-integration-guide
  <commit>`, where `<commit>` is the `integrations` commit that has your
  change. Nothing breaks if that comes late, because the Assistant just
  keeps using the older rules until then.

## Never

- Never put keys, tokens, passwords or personal data in code, tests,
  recordings, docs, commit messages or pull request text. That includes
  names and e-mail addresses of real people. Use the fakes in the tests
  and `example.com` addresses.
- Never add a library without an entry in `tooling/check/dependencies.json`
  and Liam's review. Every library an integration uses also needs the
  user's approval, because integrations ship in the cloud runtime. Dev
  tooling needs Liam's approval only. Integrations use no outside code
  except Zod and, in
  rare cases, one library for their own service that brings in nothing
  else ([dependencies.md](docs/guides/dependencies.md)).
- Never use Node APIs, `fetch` or dynamic code in an integration. Go
  through the kit.
- Never commit a recording you haven't read.

## Where things go

| Folder                                    | What                                                 |
| ----------------------------------------- | ---------------------------------------------------- |
| `integrations/models/<provider>`          | one model provider                                   |
| `integrations/knowledge/<source>`         | one knowledge source, such as `knowledge/mcp-online` |
| `integrations/tools/<provider>/<service>` | one service with tools, such as `tools/google/gmail` |
| `integrations/<name>`                     | an integration in no group, such as `mcp`            |
| `tooling/<name>`                          | the repo's own tools: `check`, `config`, `record`    |
| `docs/guides`                             | how we work here                                     |

Each integration folder holds its permission sheet and its recordings.
Section 2 of the integrations guide has the details and the names.
