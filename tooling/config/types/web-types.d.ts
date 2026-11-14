/**
 * Web-standard types for the core (multi-cloud ADR 5.1, C14).
 *
 * Only interfaces and type aliases live here, never values. So a port can
 * name `Request` or `ReadableStream<Uint8Array>`, but core code that calls
 * `fetch`, `new Request()` or `setTimeout` does not compile. The values are
 * in `web-globals.d.ts`, which only the host preset loads.
 *
 * Why an in-house subset and not `lib.dom`: `lib.dom` would also bring
 * `document`, `window`, `localStorage` and every other browser global, and
 * we would need a second check to forbid them. A short file we own keeps
 * them compile errors with no extra check, and shows in one place what the
 * core may rely on. Nothing Node-specific (`Buffer`, `process`) is here.
 *
 * Each member copies its `lib.dom` signature (narrowed where `lib.dom` says
 * `any`), so real objects from a browser, Node or a Worker fit these types.
 * In packages that load `lib.dom` or `@types/node` these names come from
 * there instead; this file is never loaded next to them. Add a member only
 * when a port needs it, with the same signature as `lib.dom`.
 */

type BufferSource = ArrayBufferView<ArrayBuffer> | ArrayBuffer;
type AllowSharedBufferSource = ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;

// --- URLs -------------------------------------------------------------------

interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toJSON(): string;
  toString(): string;
}

interface URLSearchParams {
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  forEach(callbackfn: (value: string, key: string, parent: URLSearchParams) => void): void;
  entries(): URLSearchParamsIterator<[string, string]>;
  keys(): URLSearchParamsIterator<string>;
  values(): URLSearchParamsIterator<string>;
  [Symbol.iterator](): URLSearchParamsIterator<[string, string]>;
}

interface URLSearchParamsIterator<T> extends IteratorObject<T, BuiltinIteratorReturn, unknown> {
  [Symbol.iterator](): URLSearchParamsIterator<T>;
}

// --- HTTP -------------------------------------------------------------------

type HeadersInit = [string, string][] | Record<string, string> | Headers;

interface Headers {
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  getSetCookie(): string[];
  has(name: string): boolean;
  set(name: string, value: string): void;
  forEach(callbackfn: (value: string, key: string, parent: Headers) => void): void;
  entries(): HeadersIterator<[string, string]>;
  keys(): HeadersIterator<string>;
  values(): HeadersIterator<string>;
  [Symbol.iterator](): HeadersIterator<[string, string]>;
}

interface HeadersIterator<T> extends IteratorObject<T, BuiltinIteratorReturn, unknown> {
  [Symbol.iterator](): HeadersIterator<T>;
}

/** What a request or response body can be made from. `Blob` and `FormData` are left out. */
type BodyInit = ReadableStream<Uint8Array> | string | BufferSource | URLSearchParams;

/** The body members `Request` and `Response` share. */
interface Body {
  readonly body: ReadableStream<Uint8Array<ArrayBuffer>> | null;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
  /** `lib.dom` says `Promise<any>`; here the caller has to check what it got. */
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type RequestInfo = Request | string;
type RequestRedirect = "error" | "follow" | "manual";

interface RequestInit {
  body?: BodyInit | null;
  headers?: HeadersInit;
  method?: string;
  redirect?: RequestRedirect;
  signal?: AbortSignal | null;
}

interface Request extends Body {
  readonly headers: Headers;
  readonly method: string;
  readonly redirect: RequestRedirect;
  readonly signal: AbortSignal;
  readonly url: string;
  clone(): Request;
}

interface ResponseInit {
  headers?: HeadersInit;
  status?: number;
  statusText?: string;
}

type ResponseType = "basic" | "cors" | "default" | "error" | "opaque" | "opaqueredirect";

interface Response extends Body {
  readonly headers: Headers;
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly type: ResponseType;
  readonly url: string;
  clone(): Response;
}

// --- Cancellation -----------------------------------------------------------

interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  throwIfAborted(): void;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

// --- Streams ----------------------------------------------------------------

interface ReadableStream<R = unknown> {
  readonly locked: boolean;
  cancel(reason?: unknown): Promise<void>;
  getReader(): ReadableStreamDefaultReader<R>;
  pipeThrough<T>(
    transform: ReadableWritablePair<T, R>,
    options?: StreamPipeOptions,
  ): ReadableStream<T>;
  pipeTo(destination: WritableStream<R>, options?: StreamPipeOptions): Promise<void>;
  tee(): [ReadableStream<R>, ReadableStream<R>];
}

interface ReadableStreamDefaultReader<R = unknown> {
  readonly closed: Promise<void>;
  cancel(reason?: unknown): Promise<void>;
  read(): Promise<ReadableStreamReadResult<R>>;
  releaseLock(): void;
}

type ReadableStreamReadResult<T> = { done: false; value: T } | { done: true; value?: undefined };

interface WritableStream<W = unknown> {
  readonly locked: boolean;
  abort(reason?: unknown): Promise<void>;
  close(): Promise<void>;
  getWriter(): WritableStreamDefaultWriter<W>;
}

interface WritableStreamDefaultWriter<W = unknown> {
  readonly closed: Promise<void>;
  readonly desiredSize: number | null;
  readonly ready: Promise<void>;
  abort(reason?: unknown): Promise<void>;
  close(): Promise<void>;
  releaseLock(): void;
  write(chunk: W): Promise<void>;
}

interface ReadableWritablePair<R = unknown, W = unknown> {
  readable: ReadableStream<R>;
  writable: WritableStream<W>;
}

interface TransformStream<I = unknown, O = unknown> {
  readonly readable: ReadableStream<O>;
  readonly writable: WritableStream<I>;
}

interface StreamPipeOptions {
  preventAbort?: boolean;
  preventCancel?: boolean;
  preventClose?: boolean;
  signal?: AbortSignal;
}

// --- Text -------------------------------------------------------------------

interface TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array<ArrayBuffer>;
  encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
}

interface TextDecoder {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(input?: AllowSharedBufferSource, options?: { stream?: boolean }): string;
}

// --- Crypto -----------------------------------------------------------------

interface Crypto {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
}

interface Algorithm {
  name: string;
}

type AlgorithmIdentifier = Algorithm | string;

/** PBKDF2 for `deriveBits`: the salt, the rounds and the HMAC hash. */
interface Pbkdf2Params extends Algorithm {
  hash: AlgorithmIdentifier;
  iterations: number;
  salt: BufferSource;
}
/** HMAC for `importKey`: the hash it signs with. */
interface HmacImportParams extends Algorithm {
  hash: AlgorithmIdentifier;
}
type KeyFormat = "jwk" | "pkcs8" | "raw" | "spki";
type KeyType = "private" | "public" | "secret";
type KeyUsage =
  | "decrypt"
  | "deriveBits"
  | "deriveKey"
  | "encrypt"
  | "sign"
  | "unwrapKey"
  | "verify"
  | "wrapKey";

interface CryptoKey {
  readonly algorithm: Algorithm;
  readonly extractable: boolean;
  readonly type: KeyType;
  readonly usages: KeyUsage[];
}

interface CryptoKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

/** The raw-key subset; JSON Web Keys come when a port needs them. */
interface SubtleCrypto {
  decrypt(algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  deriveBits(
    algorithm: AlgorithmIdentifier | Pbkdf2Params,
    baseKey: CryptoKey,
    length: number,
  ): Promise<ArrayBuffer>;
  digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer>;
  encrypt(algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  exportKey(format: Exclude<KeyFormat, "jwk">, key: CryptoKey): Promise<ArrayBuffer>;
  generateKey(
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKeyPair | CryptoKey>;
  importKey(
    format: Exclude<KeyFormat, "jwk">,
    keyData: BufferSource,
    algorithm: AlgorithmIdentifier | HmacImportParams,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  sign(algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  verify(
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    signature: BufferSource,
    data: BufferSource,
  ): Promise<boolean>;
}
