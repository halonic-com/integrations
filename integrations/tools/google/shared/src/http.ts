/**
 * The small part of the kit's integration host this library uses: its HTTP
 * client and its `wait`.
 *
 * The client follows the `HttpClient` port in the main repo
 * (`packages/core/ports/src/http-client.ts`): the same signature as the Web
 * `fetch`, where an HTTP error status still resolves. On top of the port,
 * the kit's `host.http` takes `auth`, which names a secret for the kit to
 * add, so this library never sees a key or token value. `wait` and
 * {@link maxIntegrationWaitMs} follow `IntegrationHost` in
 * `packages/core/ports/src/integration.ts`.
 *
 * Not settled yet: these are local types until the kit is published. Then
 * they become imports from `@halonicjs/integration-kit` and `@halonicjs/ports`.
 */

/**
 * The longest `host.wait` waits, in milliseconds (30 s). The host enforces
 * it; the retry policy gives up before asking for longer.
 */
export const maxIntegrationWaitMs = 30_000;

/** Where the kit puts a secret. Google only needs a bearer token. */
export interface SecretPlacement {
  /** The secret's name in the permission sheet, such as `google-account`. */
  readonly secret: string;
  readonly as: "bearer";
}

/** The options of one request: `fetch`'s options, plus `auth`. */
export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal | undefined;
  auth?: SecretPlacement;
}

/** The parts of a `Response` this library reads. */
export interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/**
 * Sends requests for the integration: `host.http` in an integration, a fake
 * in tests.
 */
export interface HttpClient {
  /**
   * Sends one request. An HTTP error status still resolves; check `ok`.
   *
   * @throws the kit's own errors, such as a refused host or a timeout, and
   *   network errors. This library lets them through unchanged.
   */
  fetch(url: string, init?: HttpRequestInit): Promise<HttpResponse>;
}

/**
 * The part of the kit's `IntegrationHost` this library uses, as
 * `Pick<IntegrationHost, "http" | "wait">`. Tests pass `{ http, wait }`.
 */
export interface GoogleHost {
  readonly http: HttpClient;
  /**
   * Waits `ms` milliseconds, at most {@link maxIntegrationWaitMs}. Pass the
   * call's own `signal`, so cancelling the call also cancels the pause.
   *
   * @throws `signal.reason` when `signal` aborts during the wait or is already aborted
   */
  wait(ms: number, signal?: AbortSignal): Promise<void>;
}
