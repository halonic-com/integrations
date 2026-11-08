import type { OutgoingMessage } from "../json-rpc.ts";
import type { McpTransport } from "../transport.ts";

/**
 * What the fake server sends back to one request: messages, given the
 * request's id. A test holds an answer back by returning a promise.
 */
export type ScriptedAnswer = (id: number) => unknown[] | Promise<unknown[]>;

/**
 * A transport that answers each request with the next scripted list of
 * messages, and records everything the session sent.
 */
export class FakeTransport implements McpTransport {
  readonly sent: OutgoingMessage[] = [];
  protocolVersion: string | undefined;
  closed = false;
  readonly #answers: ScriptedAnswer[];

  constructor(answers: ScriptedAnswer[]) {
    this.#answers = [...answers];
  }

  /** The requests sent, without notifications and responses. */
  get requests(): { method: string; params?: unknown }[] {
    return this.sent.filter((message) => "method" in message && "id" in message) as {
      method: string;
      params?: unknown;
    }[];
  }

  async *send(message: OutgoingMessage): AsyncGenerator<unknown> {
    this.sent.push(message);
    if (!("method" in message && "id" in message)) {
      return;
    }
    const answer = this.#answers.shift();
    if (answer === undefined) {
      throw new Error(`No scripted answer for ${message.method}.`);
    }
    yield* await answer(message.id);
  }

  useProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** A JSON-RPC result for request `id`. */
export const result =
  (value: Record<string, unknown>): ScriptedAnswer =>
  (id) => [{ jsonrpc: "2.0", id, result: value }];

/** The server's answer to `initialize`. */
export const initialized = (
  protocolVersion = "2025-11-25",
  tools: object | null = { listChanged: true },
) =>
  result({
    protocolVersion,
    capabilities: tools === null ? {} : { tools },
    serverInfo: { name: "example-server", version: "1.0.0" },
  });
