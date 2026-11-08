/**
 * Gemini 3 and later give every `functionCall` an `id`, and expect it back
 * on the matching `functionResponse`. Gemini 2.5 gives none, but
 * `ToolCall.id` is required, so the integration makes one up from the
 * answer's `responseId` and the call's place in the answer. The
 * `responseId` keeps the id unique within a run: every answer numbers its
 * calls from 0 again, and the host keys approvals and tool results by
 * `toolCallId`.
 *
 * Only Gemini's own ids are sent to Gemini: a `functionResponse` with an
 * id Gemini didn't issue could be refused. That covers the ids made up
 * here as well as another provider's (`toolu_…`, `call_…`) after a model
 * switch. Gemini's own ids are letters and digits only; a made-up id has
 * the prefix.
 */
const generatedPrefix = "gemini-call-";
const geminiIdPattern = /^[A-Za-z0-9]+$/;

/**
 * The id for the `index`th call of an answer that came without one. An
 * answer without a `responseId` gets ids that are unique within the answer
 * only.
 */
export function generatedCallId(responseId: string | undefined, index: number): string {
  return responseId === undefined
    ? `${generatedPrefix}${index}`
    : `${generatedPrefix}${responseId}-${index}`;
}

/** The id to send Gemini for a tool call, or `undefined` for one Gemini didn't issue. */
export function idForGemini(id: string): string | undefined {
  if (id.startsWith(generatedPrefix) || !geminiIdPattern.test(id)) {
    return undefined;
  }
  return id;
}
