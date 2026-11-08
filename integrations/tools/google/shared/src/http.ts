/**
 * The small part of the kit's HTTP client this library uses.
 *
 * It follows the `HttpClient` port in the main repo
 * (`packages/core/ports/src/http-client.ts`): the same signature as the Web
 * `fetch`, where an HTTP error status still resolves. On top of the port,
 * the kit's `host.http` takes `auth`, which names a secret for the kit to
 * add, so this library never sees a key or token value.
 *
 * Not settled yet: these are local types until the kit is published. Then
 * they become imports from `@halonicjs/integration-kit`.
 */

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
