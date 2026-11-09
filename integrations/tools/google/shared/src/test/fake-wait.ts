import { type GoogleHost, maxIntegrationWaitMs } from "../http.ts";

/**
 * A `wait` for tests, and the pauses it was asked for.
 *
 * Not settled yet: this follows `fakeWait` in the main repo's
 * `@halonicjs/testing-integration` and becomes that import once this repo
 * can depend on it.
 */
export interface FakeWait {
  readonly wait: GoogleHost["wait"];
  /** Each pause, clamped as the real host clamps it, in call order. */
  readonly waits: readonly number[];
}

/**
 * A `wait` that resolves at once and records the clamped pause, so a test
 * can say "waited 2 000 ms" without waiting. Like the real host, it rejects
 * with `signal.reason` when `signal` is already aborted.
 */
export function fakeWait(): FakeWait {
  const waits: number[] = [];
  return {
    waits,
    // The host gets the call's real `AbortSignal`, so the fake can check it.
    wait: async (ms: number, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      waits.push(clampWaitMs(ms));
    },
  };
}

/** As the host clamps: `NaN` and negative values wait 0, `Infinity` waits the maximum. */
function clampWaitMs(ms: number): number {
  if (Number.isNaN(ms) || ms < 0) {
    return 0;
  }
  return Math.min(ms, maxIntegrationWaitMs);
}
