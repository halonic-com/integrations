import type { AbortSignalLike, HttpClient } from "@halonicjs/integration-shared";

/**
 * The small part of the kit's integration host our MCP client uses: its
 * HTTP client and its `wait`.
 *
 * `wait` and {@link maxIntegrationWaitMs} follow `IntegrationHost` in
 * `packages/core/ports/src/integration.ts` in the main repo, as the Google
 * library's `GoogleHost` does. The signal is the shared library's
 * `AbortSignalLike`, because the integration TypeScript preset has no Web
 * types; it becomes `AbortSignal` together with the rest of that file.
 *
 * Not settled yet: these are local types until the kit is published. Then
 * they become imports from `@halonicjs/integration-kit` and `@halonicjs/ports`.
 */

/**
 * The longest `host.wait` waits, in milliseconds (30 s). The host enforces
 * it; the transport never asks for longer.
 */
export const maxIntegrationWaitMs = 30_000;

/**
 * The part of the kit's `IntegrationHost` our MCP client uses, as
 * `Pick<IntegrationHost, "http" | "wait">`. Tests pass `{ http, wait }`.
 */
export interface McpHost {
  readonly http: HttpClient;
  /**
   * Waits `ms` milliseconds, at most {@link maxIntegrationWaitMs}. Pass the
   * call's own `signal`, so cancelling the call also cancels the pause.
   *
   * @throws `signal.reason` when `signal` aborts during the wait or is already aborted
   */
  wait(ms: number, signal?: AbortSignalLike): Promise<void>;
}
