import type { AbortSignalLike } from "@halonicjs/integration-shared";
import { type McpHost, maxIntegrationWaitMs } from "../host.ts";

/**
 * A `wait` for tests, and the pauses it was asked for.
 *
 * Not settled yet: this follows `fakeWait` in the main repo's
 * `@halonicjs/testing-integration`, as the Google library's does, and
 * becomes that import once this repo can depend on it.
 */
export interface FakeWait {
  readonly wait: McpHost["wait"];
  /** Each pause, clamped as the real host clamps it, in call order. */
  readonly waits: readonly number[];
}

/**
 * A `wait` that resolves at once and records the clamped pause, so a test
 * can say "waited 2 000 ms" without waiting. Like the real host, it rejects
 * with `signal.reason` when `signal` is aborted. `during` runs inside each
 * wait, so a test can cancel the call in the middle of a pause.
 */
export function fakeWait(during?: () => void): FakeWait {
  const waits: number[] = [];
  return {
    waits,
    wait: async (ms, signal) => {
      throwIfAborted(signal);
      waits.push(clampWaitMs(ms));
      during?.();
      throwIfAborted(signal);
    },
  };
}

function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted === true) {
    throw "reason" in signal ? signal.reason : new Error("The wait was aborted.");
  }
}

/** As the host clamps: `NaN` and negative values wait 0, `Infinity` waits the maximum. */
function clampWaitMs(ms: number): number {
  if (Number.isNaN(ms) || ms < 0) {
    return 0;
  }
  return Math.min(ms, maxIntegrationWaitMs);
}
