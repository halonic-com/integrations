import type { HttpClient, HttpRequestInit, HttpResponse } from "@halonicjs/integration-shared";

/**
 * A fake MCP server for tests. Its exchanges have the shape of a
 * `halonic.recording/1` file, so they can move into recordings once replay
 * exists, plus two things recordings can't hold: event ids and a dropped
 * connection, which the resume tests need. Like replay, it fails on an
 * unexpected call and `assertAllUsed` fails on an unused exchange.
 * `assertNoBodyLeftOpen` checks that the client read or cancelled every
 * answer, so no connection stays open.
 */
export interface FakeExchange {
  /** What the call must be; only the headers listed are compared. */
  readonly request: {
    readonly method: string;
    readonly headers?: Readonly<Record<string, string | undefined>>;
    readonly body?: unknown;
  };
  readonly response: {
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body: FakeBody;
  };
}

export type FakeBody =
  | { readonly kind: "empty" }
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "sse";
      readonly events: readonly FakeEvent[];
      /** The connection drops after the last event instead of ending. */
      readonly drop?: boolean;
      /** Sent after the events without its closing blank line; the connection then drops. */
      readonly cutEvent?: FakeEvent;
    };

/** `data` is sent as JSON; leave it out for an event with empty data, as servers send to set an id. */
export interface FakeEvent {
  readonly id?: string;
  readonly data?: unknown;
}

export const endpoint = "https://mcp.example.com/mcp";

export class FakeServer implements HttpClient {
  readonly calls: { url: string; init: HttpRequestInit | undefined }[] = [];
  readonly #exchanges: FakeExchange[];
  /** The answers whose body was neither read to the end nor cancelled. */
  readonly #openBodies = new Set<FakeExchange["response"]>();

  constructor(exchanges: readonly FakeExchange[]) {
    this.#exchanges = [...exchanges];
  }

  async fetch(url: string, init?: HttpRequestInit): Promise<HttpResponse> {
    this.calls.push({ url, init });
    const exchange = this.#exchanges.shift();
    if (exchange === undefined) throw new Error(`Unexpected call: ${init?.method} ${url}`);
    checkRequest(exchange.request, url, init);
    this.#openBodies.add(exchange.response);
    return toResponse(exchange.response, () => this.#openBodies.delete(exchange.response));
  }

  assertAllUsed(): void {
    if (this.#exchanges.length > 0)
      throw new Error(`${this.#exchanges.length} exchanges were not used.`);
  }

  assertNoBodyLeftOpen(): void {
    const statuses = [...this.#openBodies].map((response) => response.status);
    if (statuses.length > 0)
      throw new Error(`Answers left open, by status: ${statuses.join(", ")}.`);
  }
}

function checkRequest(
  expected: FakeExchange["request"],
  url: string,
  init: HttpRequestInit | undefined,
): void {
  const actual = {
    url,
    method: init?.method,
    headers: Object.fromEntries(
      Object.keys(expected.headers ?? {}).map((name) => [name, init?.headers?.[name]]),
    ),
    body: init?.body === undefined ? undefined : JSON.parse(init.body),
  };
  const wanted = {
    url: endpoint,
    method: expected.method,
    headers: expected.headers ?? {},
    body: expected.body,
  };
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(
      `Unexpected request:\n${JSON.stringify(actual)}\nwanted:\n${JSON.stringify(wanted)}`,
    );
  }
}

/** `onClosed` runs once the body is read to the end, drops or is cancelled. */
function toResponse(response: FakeExchange["response"], onClosed: () => void): HttpResponse {
  const headers = new Map(
    Object.entries(response.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const text = bodyText(response.body);
  const encoded = new TextEncoder().encode(text);
  const drop =
    response.body.kind === "sse" &&
    (response.body.drop === true || response.body.cutEvent !== undefined);
  let sent = false;
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    text: async () => {
      onClosed();
      return text;
    },
    body: {
      getReader: () => ({
        async read() {
          if (!sent) {
            sent = true;
            return { done: false, value: encoded };
          }
          onClosed();
          if (drop) throw new Error("connection reset");
          return { done: true };
        },
        cancel: async () => {
          onClosed();
        },
        releaseLock: () => undefined,
      }),
    },
  };
}

function bodyText(body: FakeBody): string {
  switch (body.kind) {
    case "empty":
      return "";
    case "json":
      return JSON.stringify(body.value);
    case "text":
      return body.text;
    case "sse": {
      const complete = body.events.map((event) => `${eventLines(event)}\n`).join("");
      return body.cutEvent === undefined ? complete : complete + eventLines(body.cutEvent);
    }
  }
}

/** The lines of one event, without the blank line that completes it. */
function eventLines(event: FakeEvent): string {
  const id = event.id === undefined ? "" : `id: ${event.id}\n`;
  const data = event.data === undefined ? "" : ` ${JSON.stringify(event.data)}`;
  return `${id}data:${data}\n`;
}
