# model-anthropic

Claude models through Anthropic's
[Messages API](https://docs.anthropic.com/en/api/messages). A model
provider only: it has no tools.

## Connecting it

Add an Anthropic API key in Settings. Halonic keeps it and the kit sends it
to `api.anthropic.com` as the `x-api-key` header; the integration only names
it (`anthropic-key`) and never sees its value.

## What it does

`chat` sends one request per call and never retries: a model call costs
money and can run for minutes, so the workflow decides whether to try
again.

| `ChatRequest`                   | Messages API                                                     |
| ------------------------------- | ---------------------------------------------------------------- |
| `system` messages               | `system`, joined by blank lines                                  |
| `user` and `assistant` messages | `messages`; messages in a row from the same side become one turn |
| assistant `toolCalls`           | `tool_use` blocks                                                |
| `tool` messages                 | `tool_result` blocks in a user turn                              |
| `tools`                         | `tools` with `input_schema`                                      |
| `maxTokens`                     | `max_tokens`, 16,000 when not set (the API requires one)         |
| `temperature`, `topP`, `stop`   | `temperature`, `top_p`, `stop_sequences`                         |
| `responseFormat: "json"`        | an instruction in `system` (see below)                           |
| `reasoningEffort`               | `output_config.effort`, with `thinking: { type: "adaptive" }`    |
| `meta`, `extra`                 | not sent                                                         |

The answer maps back to `ChatResponse`: text blocks joined, `tool_use`
blocks as `toolCalls`, the whole ordered content as `replay`, `usage` with
the input tokens, the prompt cache reads, the 5-minute and 1-hour cache
writes each in their own count, and every output token, and the stop reason as
`finishReason` (`end_turn` and `stop_sequence` → `stop`, `tool_use` →
`tool_calls`, `max_tokens` → `length`, anything else → `other`).

`stream` sends the same request with `stream: true` and reads Anthropic's
[streamed events](https://docs.anthropic.com/en/docs/build-with-claude/streaming)
with `EventStream` from `integrations/shared`. It yields each text piece as
`text`, each tool call as `tool-call` pieces (the first with the call's id
and name, then the pieces of its argument JSON; `{}` when a tool without
arguments sends none), and ends with one `done` holding exactly what `chat`
returns for the same answer: the blocks are rebuilt from the events and
mapped by the same code. Thinking isn't yielded as `reasoning`, because
`chat` keeps it only in `replay`. An `error` event mid-answer becomes an
`AnthropicError` by its type (`overloaded_error` → `unavailable`), and a
stream that ends before `message_stop` is `unexpected-response`.

Thinking is sent back unchanged: an assistant message with an Anthropic
`replay` goes back as exactly that content, signatures and block order
included. Without one, or with another provider's after a model switch,
the turn is rebuilt from `content` and `toolCalls`.

## Limits

- **Capabilities:** `tools` and `streaming`. `jsonOutput` is `false`: the Messages
  API can only guarantee JSON against a schema, and `ChatRequest` carries
  none, so a JSON answer is asked for in words. `vision` is `false` until
  `ChatMessage` carries images.
- **Headers timeout:** the sheet keeps the 10-minute `headersTimeoutMs`,
  because `chat` gets its headers only when the answer is done. `stream`
  gets them at once and then has the kit's 60 seconds between two pieces;
  Anthropic sends `ping` events to keep a slow answer inside that.
- **Sampling:** `temperature` and `topP` are sent as given, but most
  current Claude models refuse them. Opus 4.7 and later, Opus 5 and 5.5,
  Fable 5 and 5.1 and Sonnet 5 refuse any value, and Sonnet 5.5 refuses
  values other than the default. A workflow that sets them for one of these
  models gets `bad-arguments`. Haiku 4.5, Opus 4.6 and Sonnet 4.6 still
  accept them, but only without `reasoningEffort`: once thinking is on,
  Anthropic refuses any `temperature` other than 1.
- **Thinking:** without `reasoningEffort`, nothing about thinking is
  sent and each model keeps its default: current models (Opus 5 and later,
  Sonnet 5 and 5.5, Fable 5 and later) think adaptively, while Opus 4.6 to
  4.8 and Sonnet 4.6 don't think. With it, `low`, `medium` and `high` go
  out as Anthropic's
  [effort](https://platform.claude.com/docs/en/build-with-claude/effort)
  levels and adaptive thinking is switched on, so the 4.6 to 4.8 models
  think too. Effort is soft guidance: on an easy question the model can
  still skip thinking. Anthropic's `xhigh` and `max` can't be asked for,
  because `ChatParams` stops at `high`. Haiku 4.5 and Sonnet 4.5 refuse
  effort and Opus 4.5 refuses adaptive thinking, so with `reasoningEffort`
  they fail with `bad-arguments`. Keep `reasoningEffort` the same for a
  whole conversation: changing it starts a new prompt cache.
- **Spend:** prompt cache reads and writes are counted apart from
  `inputTokens`, so spend can price them at their own prices. Without
  Anthropic's `cache_creation` split, every cache write counts as a
  5-minute write.
- **Errors** are `AnthropicError` with a short code (`bad-arguments`,
  `not-signed-in`, `not-allowed`, `not-found`, `rate-limited`,
  `unavailable`, `unexpected-response`). Anthropic's own error text is never
  passed on; at most its error type, such as `(overloaded_error)`.
- **Recordings:** `tool-loop-thinking` and `effort-adaptive` were
  recorded live with `pnpm record`. The others in `recordings/` were
  written by hand, before `pnpm record` and an Anthropic test account were
  available. They follow Anthropic's documented response shapes in the
  recorder's format, scrubbed as the recorder would scrub them. Replace
  them with real recordings over time. A streamed tool call has no
  recording yet: the recorder scrubs each `partial_json` piece on its own,
  so the pieces no longer join to JSON on replay. Its mapping is tested
  with hand-written events in `from-stream.test.ts` until the recorder
  scrubs the joined arguments.
