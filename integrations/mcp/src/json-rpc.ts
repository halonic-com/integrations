import { z } from "zod";
import { McpError, unexpectedResponse } from "./errors.ts";

/**
 * JSON-RPC 2.0 messages, as MCP uses them
 * (https://modelcontextprotocol.io/specification/2025-11-25/basic#messages).
 * We send numeric ids only; the server may use strings for its own requests.
 */
export type RequestId = string | number;

type Params = Readonly<Record<string, unknown>>;

/** A request we send; the server must answer it with the same `id`. */
export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: string;
  readonly params?: Params;
}

/** A message we send that gets no answer. */
export interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Params;
}

/** Our answer to a request the server sent us. */
export type JsonRpcResponse =
  | { readonly jsonrpc: "2.0"; readonly id: RequestId; readonly result: Params }
  | {
      readonly jsonrpc: "2.0";
      readonly id: RequestId;
      readonly error: { code: number; message: string };
    };

export type OutgoingMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** A message from the server, sorted by what it is. */
export type IncomingMessage =
  | { readonly kind: "request"; readonly id: RequestId; readonly method: string }
  | { readonly kind: "notification"; readonly method: string }
  | { readonly kind: "result"; readonly id: RequestId; readonly result: Record<string, unknown> }
  | { readonly kind: "error"; readonly id: RequestId | null; readonly code: number };

/** The JSON-RPC error codes we send or read. */
export const errorCodes = {
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;

const idSchema = z.union([z.string().max(256), z.int()]);
const methodSchema = z.string().max(256);

// Only the fields we read; the rest of each message passes (guide, section 4).
const messageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: idSchema.nullable().optional(),
  method: methodSchema.optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  // The error's `message` and `data` are the server's text: we never read them.
  error: z.object({ code: z.int() }).optional(),
});

/**
 * Checks one message from the server and says what it is.
 *
 * @throws {McpError} `unexpected-response` for anything that isn't exactly one JSON-RPC message
 */
export function parseIncoming(value: unknown): IncomingMessage {
  const parsed = messageSchema.safeParse(value);
  if (!parsed.success) {
    throw unexpectedResponse();
  }
  const { id, method, result, error } = parsed.data;
  if (method !== undefined && result === undefined && error === undefined) {
    if (id === undefined) return { kind: "notification", method };
    if (id !== null) return { kind: "request", id, method };
  }
  if (method === undefined && id !== undefined) {
    if (result !== undefined && error === undefined && id !== null) {
      return { kind: "result", id, result };
    }
    if (error !== undefined && result === undefined) return { kind: "error", id, code: error.code };
  }
  throw unexpectedResponse();
}

/**
 * Turns the server's JSON-RPC error into ours. The server's message is
 * never copied (guide, section 7, rule 3); the method name is ours.
 */
export function errorForRpcCode(code: number, method: string): McpError {
  switch (code) {
    case errorCodes.invalidParams:
      return new McpError("bad-arguments", `The MCP server refused the arguments for ${method}.`);
    case errorCodes.methodNotFound:
      return new McpError("not-found", `The MCP server doesn't support ${method}.`);
    default:
      return new McpError("unavailable", `The MCP server couldn't handle ${method}.`);
  }
}
