/**
 * Gemini 3 and later give every `functionCall` an `id`, and expect it back
 * on the matching `functionResponse`. Gemini 2.5 gives none, but
 * `ToolCall.id` is required, so the integration makes one up from the
 * answer's `responseId` and the call's place in the answer. The
 * `responseId` keeps the id unique within a run: every answer numbers its
 * calls from 0 again, and the host keys approvals and tool results by
 * `toolCallId`.
 *
 * The ids made up here are never sent to Gemini: Gemini 2.5 didn't issue
 * them, and they are known by their prefix. Every other id is sent as it
 * is, on the call and on its response alike, so the two still match. That
 * includes another provider's ids (`toolu_…`, `call_…`) after a model
 * switch. Gemini's own id format isn't documented, so the integration
 * doesn't guess at it.
 */
const generatedPrefix = "gemini-call-";

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

/** The id to send Gemini for a tool call, or `undefined` for one made up here. */
export function idForGemini(id: string): string | undefined {
  return id.startsWith(generatedPrefix) ? undefined : id;
}
