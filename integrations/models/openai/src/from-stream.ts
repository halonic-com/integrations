import type { ChatResponse, ChatStreamEvent } from "@halonicjs/adapters/integration-kit";
import { EventStreamError, type ServerSentEvent } from "@halonicjs/integration-shared";
import { z } from "zod";
import { errorForStreamChunk, unexpectedResponse } from "./errors.ts";
import { fromOpenAiResponse, openAiResponseSchema } from "./from-response.ts";

/*
 * A streamed Chat Completions answer is a list of `chat.completion.chunk`
 * objects, each in the data of an event without a name, and then the text
 * `[DONE]`. Each chunk's choice holds a `delta`: pieces of the content, the
 * refusal or the tool calls. With `stream_options.include_usage`, the last
 * chunk before `[DONE]` has no choices and holds the usage.
 * https://platform.openai.com/docs/api-reference/chat-streaming
 */

/** The data that ends the stream. */
const endOfStream = "[DONE]";

const toolCallDeltaSchema = z.object({
  /** Which tool call the piece belongs to; the first is 0. */
  index: z.int().nonnegative(),
  id: z.string().nullish(),
  function: z.object({ name: z.string().nullish(), arguments: z.string().nullish() }).nullish(),
});
type ToolCallDelta = z.infer<typeof toolCallDeltaSchema>;

const choiceDeltaSchema = z.object({
  index: z.int().nonnegative(),
  delta: z.object({
    content: z.string().nullish(),
    refusal: z.string().nullish(),
    tool_calls: z.array(toolCallDeltaSchema).nullish(),
  }),
  finish_reason: z.string().nullish(),
});

/** Only the fields we read, like `openAiResponseSchema`. */
const chunkSchema = z.object({
  choices: z.array(choiceDeltaSchema),
  usage: z.unknown().optional(),
});

/** A tool call as its pieces arrive. */
interface StreamedToolCall {
  id: string | undefined;
  name: string | undefined;
  arguments: string;
}

/**
 * Reads a streamed Chat Completions answer and yields the port's stream
 * events: a `text` delta per content piece, a `tool-call` piece per piece
 * of a tool call, and at the end one `done` with exactly the response
 * `chat` gives for the same answer.
 */
export async function* fromOpenAiStream(
  events: AsyncIterable<ServerSentEvent>,
): AsyncGenerator<ChatStreamEvent> {
  const answer = new StreamedAnswer();
  try {
    for await (const event of events) {
      if (event.data === endOfStream) {
        yield* answer.finish();
        return;
      }
      yield* answer.read(parseJson(event.data));
    }
  } catch (error) {
    throw error instanceof EventStreamError ? unexpectedResponse() : error;
  }
  // The stream ended cleanly, but before `[DONE]`: the answer is incomplete.
  throw unexpectedResponse();
}

/** The answer being streamed: the content, refusal, tool calls, finish reason and usage so far. */
class StreamedAnswer {
  #content: string | null = null;
  #refusal: string | null = null;
  readonly #toolCalls = new Map<number, StreamedToolCall>();
  #finishReason: string | null = null;
  #usage: unknown;

  *read(data: unknown): Generator<ChatStreamEvent> {
    // OpenAI reports an error that happens mid-answer as a chunk with `error`.
    if (typeof data === "object" && data !== null && "error" in data) {
      throw errorForStreamChunk(data);
    }
    const chunk = chunkSchema.safeParse(data);
    if (!chunk.success) {
      throw unexpectedResponse();
    }
    if (chunk.data.usage !== undefined && chunk.data.usage !== null) {
      this.#usage = chunk.data.usage;
    }
    for (const choice of chunk.data.choices) {
      // We never ask for more than one choice.
      if (choice.index !== 0) {
        throw unexpectedResponse();
      }
      yield* this.#readChoice(choice);
    }
  }

  /**
   * The last events, then the complete answer, mapped exactly as `chat`
   * maps the non-streamed one.
   */
  *finish(): Generator<ChatStreamEvent> {
    // `chat` shows a refusal as the content only when there is no content.
    // Pieces of it aren't yielded as they come, because content could still
    // follow and take its place.
    if (this.#content === null && this.#refusal !== null && this.#refusal !== "") {
      yield { type: "text", delta: this.#refusal };
    }
    yield { type: "done", response: this.#response() };
  }

  *#readChoice({
    delta,
    finish_reason: finishReason,
  }: z.infer<typeof choiceDeltaSchema>): Generator<ChatStreamEvent> {
    if (typeof delta.content === "string") {
      this.#content = (this.#content ?? "") + delta.content;
      if (delta.content !== "") {
        yield { type: "text", delta: delta.content };
      }
    }
    if (typeof delta.refusal === "string") {
      this.#refusal = (this.#refusal ?? "") + delta.refusal;
    }
    for (const piece of delta.tool_calls ?? []) {
      yield this.#readToolCall(piece);
    }
    if (finishReason !== undefined && finishReason !== null) {
      this.#finishReason = finishReason;
    }
  }

  /**
   * The first piece of a call brings its id and name, the others more of
   * its argument JSON. A later piece that changes the id or the name is
   * refused: the caller has already shown them.
   */
  #readToolCall({ index, id, function: call }: ToolCallDelta): ChatStreamEvent {
    const piece = call?.arguments ?? "";
    const known = this.#toolCalls.get(index);
    if (known === undefined) {
      const started = { id: id ?? undefined, name: call?.name ?? undefined, arguments: piece };
      this.#toolCalls.set(index, started);
      return {
        type: "tool-call",
        index,
        ...(started.id !== undefined ? { id: started.id } : {}),
        ...(started.name !== undefined ? { name: started.name } : {}),
        arguments: piece,
      };
    }
    if (changes(known.id, id) || changes(known.name, call?.name)) {
      throw unexpectedResponse();
    }
    known.arguments += piece;
    return { type: "tool-call", index, arguments: piece };
  }

  #response(): ChatResponse {
    const parsed = openAiResponseSchema.safeParse({
      choices: [
        {
          message: {
            content: this.#content,
            refusal: this.#refusal,
            tool_calls: this.#toolCallList(),
          },
          finish_reason: this.#finishReason,
        },
      ],
      usage: this.#usage,
    });
    if (!parsed.success) {
      throw unexpectedResponse();
    }
    return fromOpenAiResponse(parsed.data);
  }

  /** The tool calls in order, as the non-streamed answer has them; `null` when there are none. */
  #toolCallList() {
    if (this.#toolCalls.size === 0) {
      return null;
    }
    const calls = [];
    for (let index = 0; index < this.#toolCalls.size; index += 1) {
      const call = this.#toolCalls.get(index);
      // The indexes must be 0, 1, 2, ...: the port's `index` is the position in `toolCalls`.
      if (call === undefined) {
        throw unexpectedResponse();
      }
      calls.push({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      });
    }
    return calls;
  }
}

/** True when a later piece sends a value that differs from the one already known. */
function changes(known: string | undefined, sent: string | null | undefined): boolean {
  return sent !== undefined && sent !== null && sent !== "" && sent !== known;
}

/** Never lets a parse error out: it quotes part of the body (guide, section 7, rule 5). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw unexpectedResponse();
  }
}
