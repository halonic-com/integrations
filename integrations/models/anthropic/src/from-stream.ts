import type { ChatStreamEvent } from "@halonicjs/adapters/integration-kit";
import { EventStreamError, type ServerSentEvent } from "@halonicjs/integration-shared";
import { z } from "zod";
import { errorForStreamEvent, unexpectedResponse } from "./errors.ts";
import {
  anthropicResponseSchema,
  cacheCreationSchema,
  fromAnthropicResponse,
} from "./from-response.ts";

/*
 * Anthropic's streamed answer, as documented in
 * https://docs.anthropic.com/en/docs/build-with-claude/streaming:
 *
 *   message_start          the message, with empty content and the input tokens
 *   content_block_start    a block begins: text, tool_use, thinking, ...
 *   content_block_delta    a piece of that block (text_delta, input_json_delta, ...)
 *   content_block_stop     the block is complete
 *   message_delta          the stop reason and the output tokens so far
 *   message_stop           the end
 *
 * plus `ping`, which keeps the connection open, and `error`, which ends the
 * answer early. Event types added later are skipped.
 */

const blockIndexSchema = z.int().nonnegative();

/** Every count is optional: `message_delta` repeats only some of them. */
const usageSchema = z.object({
  input_tokens: z.int().nonnegative().optional(),
  output_tokens: z.int().nonnegative().optional(),
  cache_creation_input_tokens: z.int().nonnegative().nullish(),
  cache_read_input_tokens: z.int().nonnegative().nullish(),
  cache_creation: cacheCreationSchema,
});
type StreamedUsage = z.infer<typeof usageSchema>;

const messageStartSchema = z.object({ message: z.object({ usage: usageSchema }) });

/** Loose, like the blocks in `from-response.ts`: the whole block goes back as `replay`. */
const contentBlockStartSchema = z.object({
  index: blockIndexSchema,
  content_block: z.looseObject({ type: z.string() }),
});
const toolUseStartSchema = z.looseObject({ id: z.string(), name: z.string() });

const contentBlockDeltaSchema = z.object({
  index: blockIndexSchema,
  delta: z.looseObject({ type: z.string() }),
});
const contentBlockStopSchema = z.object({ index: blockIndexSchema });

const messageDeltaSchema = z.object({
  delta: z.object({ stop_reason: z.string().nullish() }),
  usage: usageSchema.nullish(),
});

/** The fields each delta type adds to its block. Other delta types are skipped. */
const textDeltaSchema = z.object({ text: z.string() });
const inputJsonDeltaSchema = z.object({ partial_json: z.string() });
const thinkingDeltaSchema = z.object({ thinking: z.string() });
const signatureDeltaSchema = z.object({ signature: z.string() });
const citationsDeltaSchema = z.object({ citation: z.unknown() });

/**
 * One content block as it is built up, in the shape the non-streamed answer
 * has. The fields named here are the ones the deltas fill; any other field
 * of the start block is kept as it came.
 */
interface Block extends Record<string, unknown> {
  type: string;
  text?: unknown;
  thinking?: unknown;
  signature?: unknown;
  input?: unknown;
  citations?: unknown;
}

/**
 * Reads Anthropic's streamed answer and yields the port's stream events:
 * a `text` delta per text piece, a `tool-call` piece per tool call start
 * and per piece of its arguments, and at the end one `done` with exactly
 * the response `chat` gives for the same answer.
 *
 * Thinking isn't yielded as `reasoning`: `chat` keeps it only in `replay`,
 * and the stream gives the same answer as `chat`.
 */
export async function* fromAnthropicStream(
  events: AsyncIterable<ServerSentEvent>,
): AsyncGenerator<ChatStreamEvent> {
  const message = new StreamedMessage();
  try {
    for await (const event of events) {
      const data = event.type === "ping" ? undefined : parseJson(event.data);
      switch (event.type) {
        case "message_start":
          message.start(parse(messageStartSchema, data).message.usage);
          break;
        case "content_block_start":
          yield* message.startBlock(parse(contentBlockStartSchema, data));
          break;
        case "content_block_delta":
          yield* message.applyDelta(parse(contentBlockDeltaSchema, data));
          break;
        case "content_block_stop":
          yield* message.stopBlock(parse(contentBlockStopSchema, data).index);
          break;
        case "message_delta":
          message.applyMessageDelta(parse(messageDeltaSchema, data));
          break;
        case "message_stop":
          yield { type: "done", response: message.response() };
          return; // anything after the end isn't read
        case "error":
          throw errorForStreamEvent(data);
        default:
          break; // `ping` and event types added later
      }
    }
  } catch (error) {
    throw error instanceof EventStreamError ? unexpectedResponse() : error;
  }
  // The stream ended cleanly, but before `message_stop`: the answer is incomplete.
  throw unexpectedResponse();
}

/** The message being streamed: its blocks, stop reason and usage so far. */
class StreamedMessage {
  #started = false;
  readonly #blocks: Block[] = [];
  /** The open blocks, by index; a block leaves when its `content_block_stop` arrives. */
  readonly #openBlocks = new Set<number>();
  /** Argument JSON pieces of `tool_use` (and server tool) blocks, by block index. */
  readonly #inputJson = new Map<number, string>();
  /** The port counts tool calls, not blocks: block index → tool call index. */
  readonly #toolCallIndex = new Map<number, number>();
  #stopReason: string | null = null;
  #usage: StreamedUsage = {};

  start(usage: StreamedUsage): void {
    if (this.#started) {
      throw unexpectedResponse();
    }
    this.#started = true;
    this.#mergeUsage(usage);
  }

  *startBlock({
    index,
    content_block: block,
  }: z.infer<typeof contentBlockStartSchema>): Generator<ChatStreamEvent> {
    // Blocks arrive in order, one index after the other.
    if (!this.#started || index !== this.#blocks.length) {
      throw unexpectedResponse();
    }
    const opened: Block = { ...block };
    this.#blocks.push(opened);
    this.#openBlocks.add(index);
    if (opened.type === "text" && typeof opened.text === "string" && opened.text !== "") {
      yield { type: "text", delta: opened.text };
    }
    if (block.type === "tool_use") {
      const { id, name } = parse(toolUseStartSchema, block);
      const toolCallIndex = this.#toolCallIndex.size;
      this.#toolCallIndex.set(index, toolCallIndex);
      yield { type: "tool-call", index: toolCallIndex, id, name, arguments: "" };
    }
  }

  *applyDelta({
    index,
    delta,
  }: z.infer<typeof contentBlockDeltaSchema>): Generator<ChatStreamEvent> {
    const block = this.#openBlock(index);
    switch (delta.type) {
      case "text_delta": {
        const { text } = parse(textDeltaSchema, delta);
        appendText(block, "text", text);
        yield { type: "text", delta: text };
        break;
      }
      case "input_json_delta": {
        const piece = parse(inputJsonDeltaSchema, delta).partial_json;
        this.#inputJson.set(index, (this.#inputJson.get(index) ?? "") + piece);
        const toolCallIndex = this.#toolCallIndex.get(index);
        if (toolCallIndex !== undefined && piece !== "") {
          yield { type: "tool-call", index: toolCallIndex, arguments: piece };
        }
        break;
      }
      case "thinking_delta":
        appendText(block, "thinking", parse(thinkingDeltaSchema, delta).thinking);
        break;
      case "signature_delta":
        appendText(block, "signature", parse(signatureDeltaSchema, delta).signature);
        break;
      case "citations_delta": {
        const citations = Array.isArray(block.citations) ? block.citations : [];
        block.citations = [...citations, parse(citationsDeltaSchema, delta).citation];
        break;
      }
      default:
        break; // a delta type added later
    }
  }

  /** Parses a block's argument JSON once it is complete. */
  *stopBlock(index: number): Generator<ChatStreamEvent> {
    const block = this.#openBlock(index);
    this.#openBlocks.delete(index);
    const inputJson = this.#inputJson.get(index);
    if (inputJson !== undefined && inputJson !== "") {
      block.input = parseArguments(inputJson);
      return;
    }
    // A tool without arguments may send no JSON at all. The pieces must
    // still join to JSON that parses to the arguments, so send the input
    // the start block had, `{}`.
    const toolCallIndex = this.#toolCallIndex.get(index);
    if (toolCallIndex !== undefined) {
      yield { type: "tool-call", index: toolCallIndex, arguments: JSON.stringify(block.input) };
    }
  }

  applyMessageDelta({ delta, usage }: z.infer<typeof messageDeltaSchema>): void {
    if (delta.stop_reason !== undefined) {
      this.#stopReason = delta.stop_reason;
    }
    this.#mergeUsage(usage ?? {});
  }

  /** The complete answer, mapped exactly as `chat` maps the non-streamed one. */
  response() {
    if (!this.#started || this.#openBlocks.size > 0) {
      throw unexpectedResponse();
    }
    const parsed = anthropicResponseSchema.safeParse({
      content: this.#blocks,
      stop_reason: this.#stopReason,
      usage: this.#usage,
    });
    if (!parsed.success) {
      throw unexpectedResponse();
    }
    return fromAnthropicResponse(parsed.data);
  }

  #openBlock(index: number): Block {
    const block = this.#blocks[index];
    if (block === undefined || !this.#openBlocks.has(index)) {
      throw unexpectedResponse();
    }
    return block;
  }

  /**
   * `message_start` has the input tokens; `message_delta` has the output
   * tokens so far and may repeat the others. The latest count wins.
   */
  #mergeUsage(usage: StreamedUsage): void {
    for (const [field, count] of Object.entries(usage)) {
      if (count !== undefined && count !== null) {
        this.#usage = { ...this.#usage, [field]: count };
      }
    }
  }
}

/** Adds a piece to a string field of a block; the field must be a string already. */
function appendText(block: Block, field: "text" | "thinking" | "signature", piece: string): void {
  const current = block[field] ?? "";
  if (typeof current !== "string") {
    throw unexpectedResponse();
  }
  block[field] = current + piece;
}

/** A tool's arguments: a JSON object, like `input` in a non-streamed answer. */
function parseArguments(json: string): Record<string, unknown> {
  const value = parseJson(json);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw unexpectedResponse();
  }
  return value as Record<string, unknown>;
}

/** Never lets a parse error out: it quotes part of the body (guide, section 7, rule 5). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw unexpectedResponse();
  }
}

/** Never lets a `ZodError` out: it can hold values from the body. */
function parse<Schema extends z.ZodType>(schema: Schema, value: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw unexpectedResponse();
  }
  return parsed.data;
}
