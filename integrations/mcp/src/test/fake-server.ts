import type {
  IntegrationHttpClient,
  IntegrationRequestInit,
} from "@halonicjs/adapters/integration-kit";

/**
 * A fake MCP server for tests. Its exchanges have the shape of a
 * `halonic.recording/1` file, so they can move into recordings once replay
 * exists, plus what recordings can't hold: event ids, `retry:` and a
 * dropped connection, which the resume tests need. Like replay, it fails on an
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
  /** Sent as it is in a `retry:` line, so a test can also send an invalid value. */
  readonly retry?: string;
}

export const endpoint = "https://mcp.example.com/mcp";

export class FakeServer implements IntegrationHttpClient {
  readonly calls: { url: string; init: IntegrationRequestInit | undefined }[] = [];
  readonly #exchanges: FakeExchange[];
  /** The answers whose body was neither read to the end nor cancelled. */
  readonly #openBodies = new Set<FakeExchange["response"]>();

  constructor(exchanges: readonly FakeExchange[]) {
    this.#exchanges = [...exchanges];
  }

  async fetch(url: string, init?: IntegrationRequestInit): Promise<Response> {
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
  init: IntegrationRequestInit | undefined,
): void {
  const sentHeaders = new Headers(init?.headers);
  const actual = {
    url,
    method: init?.method,
    headers: Object.fromEntries(
      Object.keys(expected.headers ?? {}).map((name) => [name, sentHeaders.get(name) ?? undefined]),
    ),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
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
function toResponse(response: FakeExchange["response"], onClosed: () => void): Response {
  const encoded = new TextEncoder().encode(bodyText(response.body));
  const drop =
    response.body.kind === "sse" &&
    (response.body.drop === true || response.body.cutEvent !== undefined);
  let sent = false;
  // The high water mark is 0, so `pull` runs only when the client reads.
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(encoded);
          return;
        }
        onClosed();
        if (drop) controller.error(new Error("connection reset"));
        else controller.close();
      },
      cancel: onClosed,
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status: response.status, headers: response.headers ?? {} });
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
  const retry = event.retry === undefined ? "" : `retry: ${event.retry}\n`;
  const id = event.id === undefined ? "" : `id: ${event.id}\n`;
  const data = event.data === undefined ? "" : ` ${JSON.stringify(event.data)}`;
  return `${retry}${id}data:${data}\n`;
}
