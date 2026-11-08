# @halonicjs/tooling-check

Our own repo checks: package manifests, layers, dependencies, names, file
size, the lockfile, absolute local paths, the Google fields of the
permission sheets, licences and the personal-terms guard. Imports are read
with the TypeScript parser, not regular expressions.

- **Layer:** tooling
- **Owner:** ravi
- **Commands:** `pnpm verify [--full]`, `pnpm check [rule …]`, `pnpm check:terms`,
  `pnpm check:licences`, `pnpm check:pr-title`
- **Settings:** `policy.json` (published packages, file size),
  `dependencies.json` (approved external dependencies),
  `licences.json` (licence allow-lists),
  `terms-allowed-phrases.txt`

What each rule checks, and how to fix a failure, is in
[docs/guides/checks.md](../../docs/guides/checks.md).

## Where it comes from

Copied from `tooling/check` in `halonic-com/halonic` at commit `0643e0b`,
so both repos check the same things. What differs:

- `src/lib/layout.ts`, `src/rules/layers.ts` and `src/rules/packages.ts`
  know this repo's two layers (`integrations`, `tooling`) instead of the
  main repo's table. Integrations may not use Node APIs, because they also
  run in the cloud runtime. They also know the integration groups
  (`models`, `knowledge`, `tools`). `packages.ts` flags a `package.json`
  under `integrations/` that pnpm doesn't see, two packages with the same
  name, and an ungrouped folder that starts with a group's prefix (such as
  `integrations/model-anthropic`).
- `src/lib/workspace.ts` reads workspace globs with `*` at any folder
  level, such as `integrations/tools/*/*`, and refuses empty, `.` and `..`
  folders in a glob.
- The Studio feature list rule and the Phase 1 slots (`trace`,
  `requirement-guard`, `dco`) are left out: this repo has no Studio, no
  requirements and needs no sign-off line.
- `dependencies.json` adds Zod, under a new `general` category.
- `src/rules/google-sheet.ts` and `src/lib/sheet-yaml.ts` are this repo's
  own: the main repo has no permission sheets. `sheet-yaml.ts` reads only
  the sheet fields the rule asks for, and only the YAML the sheets use, so
  the check needs no YAML library. It goes when `halonic validate` checks
  sheets.

Every other file is unchanged. A fix to a shared file goes into the main
repo first and is then copied here.

Uses `@typescript/typescript6` for the parser API until TypeScript 7.1
ships its own (D9); then that dependency goes.

## Not yet handled

- `@halonicjs/integration-kit` from the main repo: it comes from npm with
  an exact pin, and the `packages` rule gets a `fromMainRepo` list in
  `policy.json` (Liam's decision on #3). That rule change lands with the
  first pull request that depends on the kit (I3).
