import type { ChatResponse, ChatStreamEvent } from "@halonicjs/adapters/integration-kit";
import { EventStreamError, type ServerSentEvent } from "@halonicjs/integration-shared";
import { z } from "zod";
import { errorForStreamChunk, unexpectedResponse } from "./errors.ts";
import {
  fromGeminiResponse,
  type GeminiResponsePart,
  geminiResponseSchema,
  isFunctionCallPart,
  isTextPart,
  partSchema,
  type TextPart,
  toToolCall,
} from "./from-response.ts";

/*
 * `streamGenerateContent?alt=sse` sends the answer as events without a
 * name, each holding one chunk: a `GenerateContentResponse` with the parts
 * written since the last chunk. Text comes in pieces, a function call
 * whole. The finish reason comes on the last chunk of the candidate, with
 * the final usage. There is no end event: the connection closes. So a
 * stream that closes before a finish reason is cut off, and Google advises
 * reading until the finish reason, because a thought signature can still
 * come after the text, on a part with empty text.
 * https://aistudio.google.com/api-reference/generate-content
 * https://aistudio.google.com/docs/thought-signatures?generate-content=true
 */

/**
 * Only the fields we read, like `geminiResponseSchema`. `usageMetadata` is
 * checked by that schema when the answer is complete. A prompt Gemini
 * blocks gets one chunk with `promptFeedback` and no candidates.
 */
const chunkSchema = z.object({
  responseId: z.string().optional(),
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(partSchema).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z.unknown().optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});
type Chunk = z.infer<typeof chunkSchema>;

/**
 * Reads Gemini's streamed answer and yields the port's stream events: a
 * `text` delta per answer text piece, a `reasoning` delta per thought
 * summary piece, one `tool-call` per function call (Gemini sends each call
 * whole), and at the end one `done` with exactly the response `chat` gives
 * for the same answer.
 */
export async function* fromGeminiStream(
  events: AsyncIterable<ServerSentEvent>,
): AsyncGenerator<ChatStreamEvent> {
  const answer = new StreamedAnswer();
  try {
    for await (const event of events) {
      yield* answer.read(parseJson(event.data));
    }
  } catch (error) {
    throw error instanceof EventStreamError ? unexpectedResponse() : error;
  }
  yield { type: "done", response: answer.response() };
}

/** The answer being streamed: its parts, finish reason and usage so far. */
class StreamedAnswer {
  /** The candidate's parts as `chat` would get them: text pieces joined where that is safe. */
  readonly #parts: GeminiResponsePart[] = [];
  #sawCandidate = false;
  #responseId: string | undefined;
  #toolCallCount = 0;
  #finishReason: string | undefined;
  #usage: unknown;
  /** True once Gemini says the answer is complete: a finish reason, or a blocked prompt. */
  #complete = false;

  *read(data: unknown): Generator<ChatStreamEvent> {
    // Google reports an error that happens mid-answer as a chunk with `error`.
    if (typeof data === "object" && data !== null && "error" in data) {
      throw errorForStreamChunk(data);
    }
    const chunk = parse(chunkSchema, data);
    this.#readResponseId(chunk.responseId);
    if (chunk.usageMetadata !== undefined) {
      // Each chunk's usage counts the whole answer so far, so the latest wins.
      this.#usage = chunk.usageMetadata;
    }
    if (chunk.promptFeedback?.blockReason !== undefined) {
      this.#complete = true;
    }
    yield* this.#readCandidate(chunk.candidates);
  }

  /** The complete answer, mapped exactly as `chat` maps the non-streamed one. */
  response(): ChatResponse {
    if (!this.#complete) {
      throw unexpectedResponse();
    }
    const candidate = { content: { parts: this.#parts }, finishReason: this.#finishReason };
    const body = parse(geminiResponseSchema, {
      responseId: this.#responseId,
      candidates: this.#sawCandidate ? [candidate] : undefined,
      usageMetadata: this.#usage,
    });
    return fromGeminiResponse(body);
  }

  *#readCandidate(candidates: Chunk["candidates"]): Generator<ChatStreamEvent> {
    // The request never asks for more than one candidate.
    if (candidates === undefined || candidates.length === 0) {
      return;
    }
    const [candidate] = candidates;
    if (candidates.length > 1 || candidate === undefined) {
      throw unexpectedResponse();
    }
    this.#sawCandidate = true;
    for (const part of candidate.content?.parts ?? []) {
      yield* this.#readPart(part);
    }
    if (candidate.finishReason !== undefined) {
      this.#finishReason = candidate.finishReason;
      this.#complete = true;
    }
  }

  *#readPart(part: GeminiResponsePart): Generator<ChatStreamEvent> {
    if (isFunctionCallPart(part)) {
      this.#parts.push(part);
      const call = toToolCall(part, this.#responseId, this.#toolCallCount);
      yield {
        type: "tool-call",
        index: this.#toolCallCount,
        id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      };
      this.#toolCallCount += 1;
      return;
    }
    if (!isTextPart(part)) {
      this.#parts.push(part); // a part type we don't read: kept for `replay`
      return;
    }
    const previous = this.#parts.at(-1);
    if (previous !== undefined && canJoin(previous, part)) {
      joinText(previous, part);
    } else {
      this.#parts.push({ ...part });
    }
    if (part.text !== "") {
      yield { type: part.thought === true ? "reasoning" : "text", delta: part.text };
    }
  }

  /**
   * The id `chat` uses to make up call ids. It mustn't change during the
   * answer, nor arrive after a call already got an id made up without it.
   */
  #readResponseId(responseId: string | undefined): void {
    if (responseId === undefined || responseId === this.#responseId) {
      return;
    }
    if (this.#responseId !== undefined || this.#toolCallCount > 0) {
      throw unexpectedResponse();
    }
    this.#responseId = responseId;
  }
}

/** The fields a plain text piece has. A part with any other field is never joined. */
const textFields: ReadonlySet<string> = new Set(["text", "thought", "thoughtSignature"]);

/**
 * True when a text piece continues the part before it, as one part of the
 * non-streamed answer would hold both. Answer text and thought summary
 * aren't joined. Nothing is joined after a part with a thought signature:
 * Gemini wants each signature back on the part it came on, so a signature
 * may end a joined part but never move ahead of text that came after it.
 */
function canJoin(previous: GeminiResponsePart, piece: TextPart): previous is TextPart {
  return (
    isTextPart(previous) &&
    isPlainText(previous) &&
    isPlainText(piece) &&
    (previous.thought === true) === (piece.thought === true) &&
    previous.thoughtSignature === undefined
  );
}

function isPlainText(part: TextPart): boolean {
  return Object.keys(part).every((field) => textFields.has(field));
}

/** Adds a piece to the part before it, its signature included. */
function joinText(previous: TextPart, piece: TextPart): void {
  previous.text += piece.text;
  if (piece.thoughtSignature !== undefined) {
    previous.thoughtSignature = piece.thoughtSignature;
  }
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
