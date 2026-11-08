# Writing a Halonic integration

People and the Studio assistant both write integrations to these rules.
They follow the integration interface in the main repo
(`@halonicjs/integration-kit`). Where that interface is still being
settled, this guide says so, and it changes when the interface does.

## 1. What an integration is

One package in `integrations/<name>/` that provides one or more of: a model
provider (`llm`), a connector with tools (`connector`), or a knowledge
source (`knowledge`). It's built to the kit's interface and nothing else.

```
integrations/<name>/
├─ integration.yaml      the permission sheet: hosts, secrets, tokens, tools, needs
├─ src/index.ts          registers what it provides; the only public entry
├─ src/<part>.ts         small files, one concern each
├─ src/*.test.ts         its own tests, plus the shared conformance suite
├─ recordings/           scrubbed recorded responses, one file per scenario
└─ README.md             what it does, how to connect it, its limits
```

The package is named `@halonicjs/integration-<name>` and is private.

## 2. The permission sheet comes first

Write `integration.yaml` before any code. It lists:

- `hosts`: exact `https` host names, with no wildcards. A host the user
  chooses is `{ fromSetting: <setting> }`.
- `secrets`: each with its purpose and the hosts it may go to.
- `tokens`: what the integration stores itself, such as a refresh token.
- `tools`: name, description, argument schema, `risk` (`read` | `write` |
  `send`), and `untrusted` when the output holds outside content.
- `needs`: capabilities such as `process`. Most integrations need none.
- `recording`: the fields that hold user content, and any non-JSON content
  types the recorder may save. See [section 4](#4-tests-and-recordings).

When in doubt, pick the stricter `risk`. A tool that can reach people
outside the account is `send`.

## 3. Rules for the code

1. **All network access goes through `context.http`.** Never call `fetch`,
   `XMLHttpRequest` or `WebSocket` directly, and never touch `globalThis`
   or `process`.
2. **Never handle key values.** Ask the kit to add a key
   (`auth: { secret, as }`). Your code never sees the value. OAuth refresh
   goes through the kit's helper.
3. **No dynamic code:** no `eval`, no `new Function`, no `import()` with a
   computed name, and no `node:*` outside tests. Every integration must fit
   in the cloud runtime bundle. `pnpm check` fails on Node APIs, and the
   integration TypeScript preset has no Node or browser types.
4. **No outside libraries** apart from Zod. HTTP and JSON are written on
   `context.http`, and we write our own MCP and Google clients. The rare
   exception is in [dependencies.md](dependencies.md).
5. **Check everything that comes back** with a Zod schema. A provider's
   error body never goes into a thrown message or a tool result as-is. Map
   it to a typed error with a short, safe message.
6. **Honour `signal` and timeouts** on every call.
7. **Readable over short:** small files, named functions, a comment where
   the reason isn't obvious. `src/index.ts` names the public API
   explicitly (no `export *`).

## 4. Tests and recordings

- The shared conformance suite from the kit must pass on recorded
  responses, in Node and in `workerd`.
- Record with `pnpm record <name>` on your own machine (`tooling/record`).
  Each scenario is one file, `recordings/<scenario>.json`, in the
  `halonic.recording/1` format: the calls in order, no timestamps, no
  machine details. On replay, an unexpected call or an unused recording
  fails the test.
- The recorder scrubs before it writes. The integration's own keys become
  `<scrubbed:secret>`. Tokens the service issued become
  `scrubbed-secret-1`, `scrubbed-secret-2` and so on, so a page token can
  still be followed from one call to the next. Content becomes
  `<scrubbed:content>`, and e-mail addresses and phone numbers get
  fictional stand-ins. A final scan refuses to save anything that still
  looks like a key or personal data.
- **Read every recording before you commit it.**
- Never commit keys, tokens or personal data, including in recordings,
  fixtures, comments or commit messages. The secret scan and the
  personal-terms guard check this in CI.

## 5. Shipping

Small pull requests to `halonic-com/integrations`, never straight to
`main`. The checks match the main repo's ([checks.md](checks.md)); run
`pnpm verify` before you ask for review. An integration offered from the
Studio goes through the same checks, plus a review.
