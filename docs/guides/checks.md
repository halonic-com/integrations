# Checks

Every pull request runs the same checks as `pnpm verify --full`. Run
`pnpm verify` before you ask for review: it runs the fast checks and then
typecheck, lint and test for the packages your change affects.

The checks are the main repo's (`halonic-com/halonic`), adapted to this
repo's two layers. When a check changes there, change it here too.

| Command               | What it does                                                                         |
| --------------------- | ------------------------------------------------------------------------------------ |
| `pnpm verify`         | everything below, for the affected packages (`--full` for every package, as CI does) |
| `pnpm check [rule …]` | our own repo checks (table below); with rule names, only those                       |
| `pnpm check:terms`    | the personal-terms guard; skipped locally unless you have the list                   |
| `pnpm check:licences` | every installed package's licence against `tooling/check/licences.json`              |
| `pnpm check:pr-title` | the pull request title (used as the squash commit message)                           |

## `pnpm check` rules

| Rule             | Fails when                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages`       | a package's name doesn't follow from its folder; it isn't `private` (unless listed under `published` in `tooling/check/policy.json`); it doesn't declare `"halonic": { "layer", "owner" }`; an integration exports more than `.`; an internal dependency isn't `workspace:*` |
| `layers`         | a dependency or an import breaks the layer table below; a relative import leaves its package; an import goes past another package's `exports`; an integration uses Node APIs outside its tests                                                                               |
| `dependencies`   | an external dependency isn't in `tooling/check/dependencies.json`, is used outside its `allowedIn` packages, doesn't use a `catalog:` version, or is dev tooling outside `devDependencies`. See [dependencies.md](dependencies.md)                                           |
| `names`          | a file or path contains a package name in the `@halonic` or `@studio` npm scope. Both scopes belong to someone else                                                                                                                                                          |
| `file-size`      | a source file has more than 500 lines (a warning above 300; a warning for functions above 60). Generated files and fixtures are exempt                                                                                                                                       |
| `lockfile`       | a `pnpm-lock.yaml` entry has no sha512 hash, or comes from a tarball URL, git, a local folder or another registry. The only exception is the Node runtime from `devEngines`, which must come from the Node.js release hosts with a hash per platform                         |
| `absolute-paths` | docs, code or config hold an absolute path from one machine, such as a Windows user folder or a Linux home folder. Tests and fixtures are exempt                                                                                                                             |

## Licences

`pnpm check:licences` reads the installed packages' licences. Production
dependencies must use a licence from the `shipped` list in
`tooling/check/licences.json`; dev tooling may also use the `devOnly`
list. `OR` needs one allowed side, `AND` both. A package whose licence
field is wrong upstream goes under `corrections`, after Julian has
checked it by hand.

## Package names and layers

A package's layer and npm name follow from its folder, so nobody has to
invent a name:

| Folder                                    | Layer        | Name                                               |
| ----------------------------------------- | ------------ | -------------------------------------------------- |
| `integrations/models/<provider>`          | integrations | `@halonicjs/integration-model-<provider>`          |
| `integrations/knowledge/<source>`         | integrations | `@halonicjs/integration-knowledge-<source>`        |
| `integrations/tools/<provider>/<service>` | integrations | `@halonicjs/integration-tool-<provider>-<service>` |
| `integrations/<name>` (no group)          | integrations | `@halonicjs/integration-<name>`                    |
| `tooling/<name>`                          | tooling      | `@halonicjs/tooling-<name>`                        |

`models`, `knowledge` and `tools` are group folders, never packages
themselves. Every folder name is kebab-case. A `package.json` under
`integrations/` that matches none of these places fails the check, because
pnpm wouldn't see it. The groups are explained in
[integrations.md](integrations.md#2-where-it-goes-and-what-its-called).

Who may use what:

| Layer        | May use                                                                    | Never                                    |
| ------------ | -------------------------------------------------------------------------- | ---------------------------------------- |
| integrations | other integrations' public entry points, Zod, its approved outside library | Node APIs, tooling packages at runtime   |
| tooling      | other tooling packages                                                     | integrations, being a runtime dependency |

Tests (`*.test.ts`, `test/` folders) and tool config files
(`vitest.config.ts`) may use dev tooling and Node APIs in every layer.

## The personal-terms guard

Nothing private may enter the repo. The list of protected terms is never
in the repo: CI reads it from the `HALONIC_DENY_TERMS` Actions secret, and
you can keep a local copy in `~/.config/halonic/deny-terms` (one term per
line). The guard scans changed files and their names, commit messages and
authors, the branch name and the pull request title and body. It prints
where a term is, never the term, and withholds path parts that contain
one. Harmless technical phrases that contain a term go in
`tooling/check/terms-allowed-phrases.txt`. Until the secret is set, the
guard passes with a warning that says nothing was scanned.

## CI

`.github/workflows/ci.yml` runs on every pull request, in the merge queue
and on `main`. The only required check is `ci-ok`: it always runs, waits
for every other job and fails if any failed.

| Job                          | What                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Fast gates                   | pull request title, `pnpm check`, licences, formatting, `pnpm audit` for shipped dependencies                    |
| Personal-terms guard         | the guard over the change; runs only our own script, no dependencies, so the secret never meets third-party code |
| Secret scan                  | `gitleaks` over the pull request's commits, from a digest-pinned image                                           |
| Workflow lint                | `zizmor` over `.github/`                                                                                         |
| Typecheck, lint, test, build | every task through Turbo; unchanged packages are cache hits                                                      |

`.github/workflows/scheduled.yml` runs the advisories, the lockfile and
the licence check daily, and the full terms and secret scan over the whole
history weekly. A failure opens an issue.
