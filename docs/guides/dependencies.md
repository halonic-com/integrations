# Dependencies

Adding a dependency is a decision, not a side effect (plan 7.1).

1. **Integrations use no outside code by default.** HTTP and JSON are
   written on the kit's `context.http`, and we write our own MCP and
   Google clients.
2. **An outside-world library** is allowed only in the one integration
   that talks to that service, and only if it brings in nothing else.
   Otherwise we write a small connector on built-in web requests.
3. **Zod** is the one general exception (category `general`).
4. **Dev tooling** (compiler, test runner, linter, build cache) goes in
   `devDependencies` and never ships.

Integrations also run in the cloud runtime, which carries only the
provider's own code, our code and Zod. The rules above keep every
integration inside that.

## Adding one

1. Add an entry to `tooling/check/dependencies.json`:

   ```json
   "some-library": {
     "category": "outside-world",
     "allowedIn": ["@halonicjs/integration-some-service"],
     "reason": "Why we need it and what writing it ourselves would cost."
   }
   ```

   `category` is `outside-world`, `general` (Zod only) or `dev-tooling`.
   `allowedIn` lists package names; `*` matches any text.
2. Add the version once to the `catalog:` in `pnpm-workspace.yaml`.
3. Use `"some-library": "catalog:"` in the package's `package.json`.
4. Liam reviews it in the pull request, and every library an integration
   uses also needs the user's approval, because integrations ship in the
   cloud runtime (plan 7.1 point 2a). Dev tooling needs Liam's approval
   only.

## Install hardening

`pnpm-workspace.yaml` sets these for every install:

- **`minimumReleaseAge: 4320`**: a release must be 3 days old. For an
  urgent security fix, add the package to `minimumReleaseAgeExclude` in its
  own pull request and remove it again afterwards.
- **`allowBuilds`**: install scripts run only for listed packages; an
  unlisted one fails the install.
- **`blockExoticSubdeps`**: no git or tarball URLs anywhere in the tree.
- **`trustPolicy: no-downgrade`**: the install fails when a package loses
  its trusted-publisher status, a common sign of a hijack.
- **`registries`**: the `@halonicjs` scope always comes from npm.

Internal dependencies always use `"workspace:*"`. A version range would let
pnpm look the name up on the registry.

Never edit `pnpm-lock.yaml` by hand. On a conflict, take either side and
run `pnpm install`.
