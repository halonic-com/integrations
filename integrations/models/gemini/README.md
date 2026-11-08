# model-gemini

Google's Gemini models through the Gemini API's
[`generateContent`](https://aistudio.google.com/api-reference/generate-content), with an
API key from Google AI Studio. A model provider only: it has no tools.

## Connecting it

Add a Gemini API key in Settings. Halonic keeps it and the kit sends it to
`generativelanguage.googleapis.com` in the `x-goog-api-key` header; the
integration only names it (`gemini-key`) and never sees its value. The key
never goes into the URL as `?key=`, so it can't end up in a URL, a log or
a recording.

It uses an API key, not the Google sign-in, so it stands on its own: it
doesn't use `tools/google/shared` and doesn't need a Google account to be
connected.

## What it does

`chat` sends one request per call and never retries: a model call costs
money and can run for minutes, so the workflow decides whether to try
again.

| `ChatRequest`                 | Gemini API                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `system` messages             | `systemInstruction`                                                           |
| `user` messages               | `contents` with role `user`                                                   |
| `assistant` messages          | `contents` with role `model`: its `replay` as it came, or rebuilt (see below) |
| `tool` messages               | `functionResponse` parts with the call's `id` and name, joined into one turn  |
| `tools`                       | one `tools` entry with a `functionDeclarations` list (`parametersJsonSchema`) |
| `maxTokens`                   | `generationConfig.maxOutputTokens` (none sent when not set)                   |
| `temperature`, `topP`, `stop` | `temperature`, `topP`, `stopSequences`                                        |
| `reasoningEffort`             | `thinkingConfig.thinkingLevel`, with `includeThoughts` for `reasoning`        |
| `responseFormat: "json"`      | `responseMimeType: application/json`                                          |
| `meta`, `extra`               | not sent                                                                      |

The answer maps back to `ChatResponse` from the first candidate: its text,
its `functionCall` parts as `toolCalls`, `usage`, and its finish reason.

### Thought signatures

Gemini 3 and later models sign their reasoning with a `thoughtSignature` on
some parts of an answer, and refuse a later request whose function calls
come back without it
([thought signatures](https://aistudio.google.com/docs/thought-signatures?generate-content=true)).
So every answer carries `replay = { type: "gemini", data: <the candidate's
parts, in order> }`, and an assistant message with a Gemini `replay` goes
back exactly as it came. Each tool call's `signature` holds its part's
signature too, so a message without a replay is rebuilt from `content` and
`toolCalls` with the signatures in place.

Another provider's turn, after a model switch, has no signatures. Its
function calls get Google's placeholder `skip_thought_signature_validator`,
which Gemini 3 accepts for history it didn't write, at some cost in
quality. Its call ids aren't sent either: only ids Gemini issued go back.

Gemini 2.5 gives function calls no id, so the integration makes one up,
`gemini-call-<responseId>-<n>`, unique within the run. Made-up ids are
never sent to Gemini.

## Limits

- **Capabilities:** `tools` and `jsonOutput`. `vision` is `false` until
  `ChatMessage` carries images. `streaming` is `false` until `stream` is
  added.
- **Sampling:** `temperature`, `topP` and `stop` are sent as given. Newer
  models refuse some of them, and a workflow that sets them for such a
  model gets `bad-arguments`.
- **Thinking:** `reasoningEffort` maps to `thinkingLevel`, which only
  Gemini 3 and later take. Gemini 2.5 takes a `thinkingBudget` instead and
  will likely refuse `thinkingLevel` with `bad-arguments`, so leave
  `reasoningEffort` unset for Gemini 2.5 models.
- **Errors** are `GeminiError` with a short code (`bad-arguments`,
  `not-signed-in`, `not-allowed`, `not-found`, `rate-limited`,
  `unavailable`, `unexpected-response`). Google's own error text is never
  passed on; at most its reason or status, such as `(API_KEY_INVALID)` or
  `(RESOURCE_EXHAUSTED)`.
- **Limits:** Gemini answers every used-up limit with `429`
  `RESOURCE_EXHAUSTED`, a daily quota as well as a per-minute one, so both
  are `rate-limited`.
