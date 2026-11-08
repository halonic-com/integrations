/**
 * A local stand-in for the kit's `HttpClient`, until
 * `@halonicjs/integration-kit` is published (HAL-135).
 *
 * It has the shape of the `HttpClient` port in the main repo
 * (`packages/core/ports/src/http-client.ts`): the signature of the Web
 * `fetch`. It is narrowed to the members our integrations use, because the
 * integration TypeScript preset has no Web types (`Response`,
 * `ReadableStream`, `AbortSignal`). A real `Response` fits these types.
 *
 * **To swap later:** delete this file, import `HttpClient` from the kit, and
 * replace `AbortSignalLike` with `AbortSignal`. Nothing else changes.
 */

/** Sends requests, but only to the hosts the permission sheet declares. */
export interface HttpClient {
  /**
   * Sends one request. An HTTP error status still resolves; check `ok`.
   *
   * @throws when the network fails, the request is aborted, or the kit refuses it
   */
  fetch(url: string, init?: HttpRequestInit): Promise<HttpResponse>;
}

/** The `fetch` options our integrations use, plus the kit's `auth`. */
export interface HttpRequestInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignalLike;
  readonly auth?: SecretPlacement;
}

/**
 * Where the kit puts a secret. The integration names the secret and never
 * sees its value (guide, section 4).
 *
 * **Not settled yet:** follows the guide; the kit's own type may still be
 * renamed (I2, HAL-99).
 */
export type SecretPlacement =
  | { readonly secret: string; readonly as: "bearer" }
  | {
      readonly secret: string;
      readonly as: "header";
      readonly header: string;
      readonly prefix?: string;
    }
  | { readonly secret: string; readonly as: "form"; readonly field: string };

/** The parts of a `Response` we read. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  /** The body as a stream of bytes; `null` when there is none. */
  readonly body: ByteStream | null;
  text(): Promise<string>;
}

/** The parts of a `ReadableStream<Uint8Array>` we use. */
export interface ByteStream {
  getReader(): ByteStreamReader;
}

/** The parts of a `ReadableStreamDefaultReader<Uint8Array>` we use. */
export interface ByteStreamReader {
  read(): Promise<
    { done: false; value: Uint8Array } | { done: true; value?: Uint8Array | undefined }
  >;
  /** Stops the stream; the connection can be closed. */
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

/** The parts of an `AbortSignal` we use: we only pass it on. */
export interface AbortSignalLike {
  readonly aborted: boolean;
}
