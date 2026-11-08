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

`stream` sends the same request with `stream: true` and
`stream_options: { include_usage: true }` (without it a streamed answer has
no token counts), and reads the
[chunks](https://platform.openai.com/docs/api-reference/chat-streaming)
with `EventStream` from `integrations/shared`. It yields each content piece
as `text` and each tool call as `tool-call` pieces (the first with the
call's id and name), and ends at `[DONE]` with one `done` holding exactly
what `chat` returns for the same answer: the answer is rebuilt from the
chunks and mapped by the same code. A refusal is yielded as one `text`
piece just before `done`, because `chat` shows it only when there is no
content. A chunk with `error` becomes an `OpenAiError` by its code if we
know it, else by its type (`context_length_exceeded` with
`invalid_request_error` → `bad-arguments`); when we know neither, it is
`unavailable`, like `server_error`. A stream that ends before `[DONE]` or
without usage is `unexpected-response`.

## Limits

- **Capabilities:** `tools`, `jsonOutput` and `streaming`. `vision` is
  `false` until `ChatMessage` carries images.
- **Headers timeout:** the sheet keeps the 10-minute `headersTimeoutMs`,
  because `chat` gets its headers only when the answer is done. `stream`
  gets them at once, and then has the kit's 60 seconds between two pieces.
  A reasoning model can think for longer than that before its first
  piece; such a stream ends with the kit's timeout, and `chat` is the
  fallback.
- **Sampling:** `temperature`, `topP` and `stop` are sent as given, but
  reasoning models refuse them, and a workflow that sets them for such a
  model gets `bad-arguments`. In the same way, only reasoning models accept
  `reasoningEffort`.
- **Broken tool arguments:** when the model's arguments aren't a JSON
  object, for example in an answer cut off at the token limit, the answer
  is refused as `unexpected-response` rather than running the tool with
  empty arguments.
- **Errors** are `OpenAiError` with a short code (`bad-arguments`,
  `not-signed-in`, `not-allowed`, `not-found`, `rate-limited`,
  `quota-exceeded`, `unavailable`, `unexpected-response`). OpenAI's own
  error text is never passed on; at most its error code, such as
  `(insufficient_quota)`.
- **Recordings** in `recordings/` were written by hand, not recorded:
  `pnpm record` and an OpenAI test account weren't available yet. They
  follow OpenAI's documented response shapes in the recorder's format,
  scrubbed as the recorder would scrub them. Replace them with real
  recordings once both are available. A streamed tool call has no
  recording yet: the recorder scrubs each piece of the arguments on its
  own, so the pieces no longer join to JSON on replay. Its mapping is
  tested with hand-written chunks in `from-stream.test.ts` until the
  recorder scrubs the joined arguments.
