/**
 * Gemini 3 and later give every `functionCall` an `id`, and expect it back
 * on the matching `functionResponse`. Gemini 2.5 gives none, but
 * `ToolCall.id` is required, so the integration makes one up from the
 * call's place in the answer.
 *
 * A made-up id is never sent to Gemini: it didn't issue it, and a
 * `functionResponse` with an id that matches no call could be refused. The
 * prefix tells them apart; Gemini's own ids are letters and digits only.
 */
const generatedPrefix = "gemini-call-";

/** The id for the `index`th call of an answer that came without one. */
export function generatedCallId(index: number): string {
  return `${generatedPrefix}${index}`;
}

/** The id to send Gemini for a tool call, or `undefined` for one we made up. */
export function idForGemini(id: string): string | undefined {
  return id.startsWith(generatedPrefix) ? undefined : id;
}
