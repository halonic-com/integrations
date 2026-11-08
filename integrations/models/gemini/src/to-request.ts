import { z } from "zod";
import { idForGemini } from "./call-ids.ts";
import type { ChatMessage, ChatParams, ChatRequest, ToolCall, ToolDefinition } from "./kit.ts";

/**
 * The `generateContent` request body, as far as we send it. The model goes
 * in the URL, not the body.
 * https://aistudio.google.com/api-reference/generate-content
 */
export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiTextPart[] };
  tools?: [{ functionDeclarations: GeminiFunctionDeclaration[] }];
  generationConfig?: GeminiGenerationConfig;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiTextPart {
  text: string;
}

export interface GeminiFunctionCallPart {
  functionCall: { id?: string; name: string; args: Record<string, unknown> };
  thoughtSignature?: string;
}

export interface GeminiFunctionResponsePart {
  functionResponse: { id?: string; name: string; response: { output: string } };
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart
  | ReplayedPart;

/** A part from an earlier answer, sent back as it came: text, thought, function call or newer. */
export type ReplayedPart = z.infer<typeof replayedPartSchema>;

/**
 * Run history is stored, so a replay is checked only as far as the API
 * needs: a list of objects. Gemini's parts have no type field; their
 * fields are Gemini's.
 */
const replayedPartSchema = z.looseObject({});
const replayedPartsSchema = z.array(replayedPartSchema);

/**
 * `parametersJsonSchema`, not `parameters`: `parameters` takes only
 * Google's OpenAPI subset and refuses fields such as `$schema` and
 * `additionalProperties`, which `z.toJSONSchema` writes.
 */
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  responseMimeType?: "application/json";
  thinkingConfig?: { thinkingLevel: "low" | "medium" | "high"; includeThoughts: true };
}

/**
 * Maps one `ChatRequest` to a `generateContent` body. `meta` is never
 * sent, and neither is `extra`, which isn't mapped yet; `ChatParams` lets
 * a provider ignore what it doesn't support.
 *
 * Sampling settings are passed on as given. Newer models refuse some of
 * them; the API is the one that knows which model takes what.
 */
export function toGeminiRequest(request: ChatRequest): GeminiRequest {
  const systemInstruction = toSystemInstruction(request.messages);
  const generationConfig = toGenerationConfig(request.params ?? {}, request.responseFormat);
  return {
    contents: toGeminiContents(request.messages),
    ...(systemInstruction !== undefined ? { systemInstruction } : {}),
    ...(request.tools?.length
      ? { tools: [{ functionDeclarations: request.tools.map(toFunctionDeclaration) }] }
      : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };
}

/** Gemini takes the system prompt apart from the conversation, as one text. */
function toSystemInstruction(messages: readonly ChatMessage[]): GeminiRequest["systemInstruction"] {
  const text = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return text === "" ? undefined : { parts: [{ text }] };
}

/**
 * A JSON answer is a real mode here (`responseMimeType`), so unlike
 * model-anthropic no instruction is added to the prompt. Gemini sends its
 * thought summary, which becomes `reasoning`, only when asked to.
 */
function toGenerationConfig(
  params: ChatParams,
  responseFormat: ChatRequest["responseFormat"],
): GeminiGenerationConfig {
  return {
    ...(params.maxTokens !== undefined ? { maxOutputTokens: params.maxTokens } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.topP !== undefined ? { topP: params.topP } : {}),
    ...(params.stop?.length ? { stopSequences: params.stop } : {}),
    ...(responseFormat === "json" ? { responseMimeType: "application/json" as const } : {}),
    ...(params.reasoningEffort !== undefined
      ? {
          thinkingConfig: { thinkingLevel: params.reasoningEffort, includeThoughts: true as const },
        }
      : {}),
  };
}

/**
 * Maps the conversation, and joins messages in a row from the same side
 * into one turn: the results of several tool calls go back as one user turn
 * with one `functionResponse` part each, as Gemini expects.
 */
export function toGeminiContents(messages: readonly ChatMessage[]): GeminiContent[] {
  const turns: GeminiContent[] = [];
  for (const message of messages) {
    const turn = toGeminiTurn(message);
    if (turn === undefined || turn.parts.length === 0) {
      continue;
    }
    const previous = turns.at(-1);
    if (previous !== undefined && previous.role === turn.role) {
      previous.parts.push(...turn.parts);
    } else {
      turns.push(turn);
    }
  }
  return turns;
}

function toGeminiTurn(message: ChatMessage): GeminiContent | undefined {
  switch (message.role) {
    case "system":
      return undefined; // sent as `systemInstruction`
    case "user":
      return { role: "user", parts: textParts(message.content) };
    case "assistant":
      return { role: "model", parts: replayedParts(message) ?? assistantParts(message) };
    case "tool":
      return { role: "user", parts: [toFunctionResponsePart(message)] };
  }
}

type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;
type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

/**
 * The turn exactly as Gemini answered it, when we have it. Thought
 * signatures must go back in the part they came on, so the turn is never
 * rebuilt from `content` and `toolCalls` while it is here. Another
 * provider's replay, after a model switch, is ignored. Parsing copies the
 * list, so joining turns never changes the stored history.
 * https://aistudio.google.com/docs/thought-signatures?generate-content=true
 */
function replayedParts(message: AssistantMessage): GeminiPart[] | undefined {
  if (message.replay?.type !== "gemini") {
    return undefined;
  }
  const parsed = replayedPartsSchema.safeParse(message.replay.data);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Without a replay, the turn is rebuilt: text first, then the function
 * calls, each with the signature it came with.
 *
 * The signature of a text-only answer, on its last text part, is lost
 * here: `ChatMessage` has no place for it. Google only recommends sending
 * that one back, it doesn't require it.
 */
function assistantParts(message: AssistantMessage): GeminiPart[] {
  return [...textParts(message.content), ...(message.toolCalls ?? []).map(toFunctionCallPart)];
}

/** Gemini refuses an empty part, so empty text sends none. */
function textParts(text: string): GeminiPart[] {
  return text === "" ? [] : [{ text }];
}

/**
 * Gemini 3 refuses a function call of the current turn without a
 * signature, and a call another provider made has none. For history
 * Gemini didn't write, Google's documented way out is this placeholder,
 * which skips the check at some cost in quality. It is only used when
 * there is no real signature.
 * https://aistudio.google.com/docs/thought-signatures?generate-content=true
 */
const skipSignatureCheck = "skip_thought_signature_validator";

function toFunctionCallPart(call: ToolCall): GeminiFunctionCallPart {
  const id = idForGemini(call.id);
  return {
    functionCall: { ...(id !== undefined ? { id } : {}), name: call.name, args: call.arguments },
    thoughtSignature: call.signature ?? skipSignatureCheck,
  };
}

/**
 * Gemini wants a JSON object as the result and lets us name its fields; a
 * tool's result is text, so it goes in `output`.
 */
function toFunctionResponsePart(message: ToolMessage): GeminiFunctionResponsePart {
  const id = idForGemini(message.toolCallId);
  return {
    functionResponse: {
      ...(id !== undefined ? { id } : {}),
      name: message.name,
      response: { output: message.content },
    },
  };
}

function toFunctionDeclaration(tool: ToolDefinition): GeminiFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  };
}
