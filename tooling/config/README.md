# @halonicjs/tooling-config

Shared settings every package extends.

- **Layer:** tooling
- **Owner:** ravi
- **Source:** copied from `tooling/config` in `halonic-com/halonic`, so code
  is formatted, linted and type-checked the same way in both repos. Change
  them together. The one addition is `tsconfig/integration.json`; the
  Studio and web presets are left out because nothing here needs them.
- **TypeScript presets** (`tsconfig/`): `base.json` (strict settings, Node's
  type stripping rules: `.ts` import extensions, erasable syntax only),
  `integration.json` (no Node or browser types, so `fetch`, `process` or
  `fs` are compile errors and the code runs in the cloud runtime too) and
  `node.json` (tooling and tests).
- **Web types** (`types/web-types.d.ts`): the Web-standard types the kit
  names, such as `Response`, `RequestInit` and `AbortSignal`, as types
  only, with no values. `integration.json` loads them. Copied unchanged
  from the main repo at commit `0fb45ca9d`, where the `core` preset loads
  them.
  A package uses `"extends": "@halonicjs/tooling-config/tsconfig/<preset>.json"`.
- **Biome** (`biome.jsonc`): formatting and lint rules, extended by the
  root `biome.json`.
- **Vitest preset** (`@halonicjs/tooling-config/vitest`):

  ```ts
  import { definePackageTestConfig } from "@halonicjs/tooling-config/vitest";

  export default definePackageTestConfig();
  ```
