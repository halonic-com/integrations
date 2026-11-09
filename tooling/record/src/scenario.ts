/**
 * What an integration's `recordings/scenarios.ts` exports for `pnpm record`.
 *
 * The file is integration code: no Node APIs, no `fetch`, only the
 * connection it gets. It is never exported from the integration's package.
 * This module imports nothing, so the integration tsconfig can typecheck it.
 *
 * @example
 * // integrations/models/example/recordings/scenarios.ts
 * import type { Scenario } from "@halonicjs/tooling-record/scenario";
 * import { example } from "../src/index.ts";
 * import type { IntegrationConnection } from "../src/kit.ts";
 *
 * export const integration = example;
 * export const scenarios: readonly Scenario<IntegrationConnection>[] = [
 *   {
 *     name: "answer-text",
 *     async run(connection) {
 *       const provider = connection.createLlmProvider?.({ id: "example", type: "example", local: false, options: {} });
 *       await provider?.chat({ model: "example-small", messages: [{ role: "user", content: "Say hello." }] });
 *     },
 *   },
 * ];
 */

/** One thing the integration does, the way a user would make it happen. */
export interface Scenario<Connection> {
  /** Kebab-case. The recording is saved as `recordings/<name>.json`. */
  readonly name: string;
  /**
   * Declared user-content paths this scenario doesn't touch, such as
   * `request.body.raw` in a scenario that only reads mail.
   */
  readonly unusedUserContent?: readonly string[];
  /** Calls the integration's tools or its model provider through `connection`. */
  run(connection: Connection): Promise<void>;
}
