# model-openai

GPT models through OpenAI's
[Chat Completions API](https://platform.openai.com/docs/api-reference/chat/create).
A model provider only: it has no tools.

## Connecting it

Add an OpenAI API key in Settings. Halonic keeps it and the kit sends it to
`api.openai.com` as `Authorization: Bearer …`; the integration only names
it (`openai-key`) and never sees its value.

## What it does

`chat` sends one request per call and never retries: a model call costs
money and can run for minutes, so the workflow decides whether to try
again.

| `ChatRequest`                 | Chat Completions                                                    |
| ----------------------------- | ------------------------------------------------------------------- |
| `system`, `user` messages     | `messages` with the same role                                       |
| `assistant` messages          | `messages`; `toolCalls` as `tool_calls` with arguments as JSON      |
| `tool` messages               | `tool` messages with `tool_call_id`                                 |
| `tools`                       | `tools` of type `function`                                          |
| `maxTokens`                   | `max_completion_tokens` (none sent when not set)                    |
| `temperature`, `topP`, `stop` | `temperature`, `top_p`, `stop`                                      |
| `reasoningEffort`             | `reasoning_effort` (only reasoning models accept it)                |
| `responseFormat: "json"`      | `response_format: json_object`, plus an instruction JSON mode needs |
| `meta`, `extra`               | not sent                                                            |

The answer maps back to `ChatResponse`: the first choice's text (or its
refusal), its `tool_calls` with the arguments parsed, `usage` from
`prompt_tokens` and `completion_tokens`, and the finish reason (`stop` →
`stop`, `tool_calls` → `tool_calls`, `length` → `length`, anything else →
`other`).

## Limits

- **Capabilities:** `tools` and `jsonOutput`. `vision` is `false` until
  `ChatMessage` carries images. `streaming` is `false` until `stream` is
  added.
- **Broken tool arguments:** when the model's arguments aren't a JSON
  object, for example in an answer cut off at the token limit, the answer
  is refused as `unexpected-response` rather than running the tool with
  empty arguments.
- **Errors** are `OpenAiError` with a short code (`bad-arguments`,
  `not-signed-in`, `not-allowed`, `not-found`, `rate-limited`,
  `quota-exceeded`, `unavailable`, `unexpected-response`). OpenAI's own
  error text is never passed on; at most its error code, such as
  `(insufficient_quota)`.
