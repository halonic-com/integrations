# tooling/copy-to-workspace

`pnpm copy-to-workspace <sheet id or path> <workspace folder>` builds an
integration of this repo into a folder a Halonic workspace runs as a local
integration, and puts it in the workspace's `integrations/<id>/`:

```sh
pnpm copy-to-workspace tool-paperclip-issues ~/work/my-workspace
```

A connector file in the workspace then names the folder, and the workspace
is trusted again (`halonic trust`):

```yaml
# library/connectors/paperclip.connector.yaml
name: Paperclip
transport:
  integration:
    folder: tool-paperclip-issues
    settings:
      url: https://tasks.example.com
      company-id: <the company's id>
    secrets:
      paperclip-key: paperclip-key # the workspace secret it gets, by name
```

## What the folder holds

| Path                       | What                                                                        |
| -------------------------- | --------------------------------------------------------------------------- |
| `integration.yaml`         | The permission sheet, unchanged                                             |
| `backend/index.js`         | The entry Halonic starts; its default export is the integration             |
| `backend/packages/<name>/` | The integration and every package it needs at run time, built to JavaScript |
| `node_modules/zod/`        | Zod, which Halonic's runner resolves from the folder itself                 |

Halonic's runner lets an integration import only its own files and `zod`
(`integration-runner.module-fence` in halonic-com/halonic). So every package
import in the built code, such as `@halonicjs/adapters/integration-kit`, is
turned into a path to that package's copy in the folder. An import of
anything else, such as `node:fs`, stops the copy with the file's name.

The packages of this repo are built with their own `tsconfig.json` and
`tsc`; packages from npm are copied as they are. No bundler: the folder
holds the same files the tests ran.

## Replacing a copy

Running it again replaces the folder, but only when the folder holds the
same integration (its `integration.yaml` has the same `id`). Any other
folder at that path stays as it is, and the command stops. A replaced
folder has a new hash, so Halonic asks for `halonic trust` again before it
starts.
