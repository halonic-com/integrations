import type { IntegrationConnection } from "@halonicjs/adapters/integration-kit";

/**
 * One scenario in `recordings/scenarios.ts`, which `pnpm record` runs
 * against the real service. Not from the kit: it is copied from
 * `tooling/record/src/scenario.ts`, so the scenario file imports nothing
 * from tooling.
 */
export interface Scenario {
  /** Kebab-case. The recording is saved as `recordings/<name>.json`. */
  readonly name: string;
  /** Declared user-content paths this scenario doesn't touch. */
  readonly unusedUserContent?: readonly string[];
  run(connection: IntegrationConnection): Promise<void>;
}
