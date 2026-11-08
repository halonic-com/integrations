# Contributing to Halonic integrations

Thank you for wanting to help. This guide explains how to set up this repo,
what an integration needs, and what a pull request needs before it can be
merged.

This repo holds the integrations for [Halonic](https://github.com/halonic-com/halonic).
The project's shared policies live in the main repo:

- By taking part you agree to follow our
  [code of conduct](https://github.com/halonic-com/halonic/blob/main/CODE_OF_CONDUCT.md).
- Security problems go to the
  [security policy](https://github.com/halonic-com/halonic/blob/main/SECURITY.md),
  never to a public issue.
- Questions are welcome in the main repo's GitHub Discussions (see
  [SUPPORT.md](https://github.com/halonic-com/halonic/blob/main/SUPPORT.md)).

## Before you start

- **Small fixes** (a typo, a clear bug with a small fix): open a pull request
  straight away.
- **Anything bigger** (a new integration, a new tool on an existing one, a new
  dependency): open an issue first, so we can agree on the approach before you
  spend time on it.
- Check that nobody is already working on it: look at the open issues and pull
  requests.

## Setup

> **Some checks are still being built.** The DCO check is not active yet.
> Until a check is active, this guide says so.

You need **Node 26 LTS**, **pnpm 12** and **Git**. pnpm manages its own
version from `packageManager` and installs the Node version the repo pins, so
installing any recent pnpm is enough.

```sh
git clone https://github.com/halonic-com/integrations.git
cd integrations
pnpm install
pnpm verify
```

`pnpm verify` runs the checks, type checks, lint and tests for the packages
your change affects. Run it before every push. `pnpm verify --full` runs
everything, as CI does. The checks are listed in
[docs/guides/checks.md](docs/guides/checks.md).

## Writing an integration

Read [docs/guides/integrations.md](docs/guides/integrations.md) before you
write or change an integration. In short:

- **Every integration is built on the integration kit** from the main repo.
  It declares a permission sheet, reaches the network only through the kit's
  HTTP client (limited to the hosts and secrets it declares), and declares
  each tool with a risk level.
- **No Node APIs, no `fetch`, no dynamic code** in an integration. Go through
  the kit.
- **No outside code except Zod**, and in rare cases one library for the
  integration's own service that brings in nothing else. Every library needs
  an entry in `tooling/check/dependencies.json` and approval first. Ask in an
  issue. See [docs/guides/dependencies.md](docs/guides/dependencies.md).
- **Tests run on recorded responses.** Record with `pnpm record <integration>`
  using your own account. The recorder scrubs keys and personal content before
  it saves, but read every recording before you commit it.

## Only made-up data

This repo is public. Never put keys, tokens, passwords or personal data in
code, tests, recordings, docs, commit messages or pull request text. That
includes names and e-mail addresses of real people. Use the fakes in the tests
and `example.com` addresses.

## Code and docs

- **Readable over short.** Clear, full names; early returns; no clever
  one-liners. Comments explain _why_, not _what_.
- **Small files.** Aim for under 300 lines; the check fails above 500.
- **Every exported function, type and class has a doc comment.**
- **Docs change in the same pull request as the behaviour.**
- Formatting is automatic (Biome). Don't reformat code you didn't otherwise
  change.

## Pull requests

- **Keep them small:** about 400 changed lines at most, not counting
  generated files, the lockfile and recordings. One topic per pull request.
- **Title in conventional-commit form**, for example
  `feat(gmail): add sending`. It becomes the squash commit message.
- **`pnpm verify` is green** before you ask for review. All checks must pass
  in CI before anything is merged.
- **Rebase on `main`** rather than merging `main` into your branch.

## Developer Certificate of Origin (DCO)

We don't ask for a contributor licence agreement. Instead, every commit must
carry a sign-off under the [Developer Certificate of Origin](https://developercertificate.org/).
By signing off you certify that you wrote the change, or otherwise have the
right to submit it under the project's open-source licence.

Sign off by committing with `-s`:

```sh
git commit -s -m "feat(gmail): add sending"
```

This adds a line with your real name and email address:

```text
Signed-off-by: Your Name <you@example.com>
```

- Only a person can sign off. An AI tool can't certify anything, so never let
  one add the line for you.
- Forgot it? `git commit --amend -s` fixes the last commit;
  `git rebase --signoff main` fixes all the commits on your branch.
- Once the DCO check is active (it is not yet), pull requests with a commit
  that isn't signed off can't be merged.

Your contribution is licensed under the [Apache License 2.0](LICENSE), the
same licence as the rest of Halonic.

## AI-assisted contributions

AI tools are welcome here, under the same rules as in the main repo:

- **You are responsible for every line you submit.** You must have run the
  change, understood it, and be able to explain it in review.
- **Say what you used** in the pull request: "AI assistance used: tool /
  model". "None" is a fine answer.
- **A person signs off.** The DCO sign-off is made by you, never by the tool.
- **Large AI-generated changes start with an issue**, not a surprise pull
  request.
- **Same bar for everyone.** AI-assisted pull requests get the same review
  and the same checks as any other.

## How changes are reviewed

1. The automated checks run.
2. A reviewer reads the change. Changes to permissions, security or the
   checks also get a review from the person who looks after that area.
3. A maintainer approves and merges with a squash merge.

We try to give a first response within a week. If you haven't heard from us,
a friendly comment on the pull request is welcome.
