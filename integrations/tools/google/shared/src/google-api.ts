import type { z } from "zod";
import { errorForResponse, type FailedRequest, unexpectedResponse } from "./error-for-response.ts";
import type { HttpClient, HttpHost, HttpRequestInit, HttpResponse } from "./http.ts";
import {
  isRepeatable,
  isRetryableStatus,
  maxRetries,
  type RetryClock,
  retryDelayMs,
} from "./retry-policy.ts";

/** How a Google integration sets up its {@link GoogleApi}. */
export interface GoogleApiOptions {
  /** The secret the kit adds as the bearer token, as named in the sheet: `google-account`. */
  readonly secret: string;
  /** The service's name for the user, used in error messages: `Gmail`, `Google Drive`. */
  readonly service: string;
  /**
   * Gives the time and waits between retries. Without one, nothing is
   * retried: a `429` or `5xx` becomes an error straight away.
   */
  readonly clock?: RetryClock | undefined;
}

/** One request to a Google API. */
export interface GoogleRequest {
  readonly method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** From {@link googleUrl}. */
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal | undefined;
  /**
   * Only for a request that changes something and that Google makes safe to
   * repeat, such as with an idempotency key. Never set it for a request
   * that sends or deletes something; a `DELETE` is never repeated anyway.
   */
  readonly repeatable?: boolean;
}

/**
 * Every request a Google integration makes goes through here. It names the
 * secret so the kit adds the access token, retries only where that is safe,
 * and turns Google's errors into {@link GoogleError}.
 *
 * Each method sends at most three requests: one, and at most two retries.
 * The kit's own errors, such as a refused host or a timeout, pass through
 * unchanged and are never retried (guide, section 7, rule 7).
 */
export class GoogleApi {
  readonly #http: HttpClient;
  readonly #options: GoogleApiOptions;

  constructor(host: HttpHost, options: GoogleApiOptions) {
    this.#http = host.http;
    this.#options = options;
  }

  /** Reads JSON with a `GET`, checked against `schema`. Retried where rule 10 allows. */
  async getJson<Schema extends z.ZodType>(
    url: string,
    schema: Schema,
    signal?: AbortSignal,
  ): Promise<z.infer<Schema>> {
    const response = await this.send({ method: "GET", url, headers: acceptJson, signal });
    return await this.#readJson(response, url, schema);
  }

  /** Reads a body as text with a `GET`, such as a Drive download or export. */
  async getText(url: string, signal?: AbortSignal): Promise<string> {
    const response = await this.send({ method: "GET", url, signal });
    return await response.text();
  }

  /**
   * Sends JSON with a `POST` and reads the JSON answer. Never retried: a
   * timeout doesn't prove the mail wasn't sent or the file wasn't created.
   */
  async postJson<Schema extends z.ZodType>(
    url: string,
    body: unknown,
    schema: Schema,
    signal?: AbortSignal,
  ): Promise<z.infer<Schema>> {
    const response = await this.send({
      method: "POST",
      url,
      headers: { ...acceptJson, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal,
    });
    return await this.#readJson(response, url, schema);
  }

  /** Sends a `DELETE`. Never retried. Google answers it with an empty body. */
  async delete(url: string, signal?: AbortSignal): Promise<void> {
    await this.send({ method: "DELETE", url, signal });
  }

  /**
   * Sends one request, retrying it where rule 10 allows, and returns the
   * successful response.
   *
   * @throws {@link GoogleError} for an error status, after any retries
   */
  async send(request: GoogleRequest): Promise<HttpResponse> {
    const mayRetry = isRepeatable(request.method, request.repeatable ?? false);
    for (let retry = 0; ; retry++) {
      const response = await this.#http.fetch(request.url, this.#init(request));
      if (response.ok) {
        return response;
      }
      const delay = mayRetry && retry < maxRetries ? this.#retryDelay(response, retry) : undefined;
      if (delay === undefined || this.#options.clock === undefined) {
        throw errorForResponse(response.status, await response.text(), this.#failed(request.url));
      }
      await this.#options.clock.sleep(delay, request.signal);
    }
  }

  /** The wait before the next try, or `undefined` when this response isn't retried. */
  #retryDelay(response: HttpResponse, retry: number): number | undefined {
    const clock = this.#options.clock;
    if (clock === undefined || !isRetryableStatus(response.status)) {
      return undefined;
    }
    return retryDelayMs(response.headers.get("retry-after"), retry, clock.now());
  }

  #init(request: GoogleRequest): HttpRequestInit {
    const init: HttpRequestInit = {
      method: request.method,
      auth: { secret: this.#options.secret, as: "bearer" },
      signal: request.signal,
    };
    if (request.headers !== undefined) init.headers = { ...request.headers };
    if (request.body !== undefined) init.body = request.body;
    return init;
  }

  /** Parses and checks a JSON body. Neither the parse error nor the `ZodError` gets out. */
  async #readJson<Schema extends z.ZodType>(
    response: HttpResponse,
    url: string,
    schema: Schema,
  ): Promise<z.infer<Schema>> {
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw unexpectedResponse(this.#failed(url));
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw unexpectedResponse(this.#failed(url));
    }
    return parsed.data;
  }

  #failed(url: string): FailedRequest {
    return { service: this.#options.service, url };
  }
}

const acceptJson = { accept: "application/json" } as const;

/**
 * Sets up the request helper for one Google service.
 *
 * @example
 * const google = googleApi(host, { secret: "google-account", service: "Gmail" });
 */
export function googleApi(host: HttpHost, options: GoogleApiOptions): GoogleApi {
  return new GoogleApi(host, options);
}
