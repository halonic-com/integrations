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

| `ChatRequest`                      | Messages API                                                     |
| ---------------------------------- | ---------------------------------------------------------------- |
| `system` messages                  | `system`, joined by blank lines                                  |
| `user` and `assistant` messages    | `messages`; messages in a row from the same side become one turn |
| assistant `toolCalls`              | `tool_use` blocks                                                |
| `tool` messages                    | `tool_result` blocks in a user turn                              |
| `tools`                            | `tools` with `input_schema`                                      |
| `maxTokens`                        | `max_tokens`, 16,000 when not set (the API requires one)         |
| `temperature`, `topP`, `stop`      | `temperature`, `top_p`, `stop_sequences`                         |
| `responseFormat: "json"`           | an instruction in `system` (see below)                           |
| `meta`, `reasoningEffort`, `extra` | not sent                                                         |

The answer maps back to `ChatResponse`: text blocks joined, `tool_use`
blocks as `toolCalls`, `usage` with every input token (prompt cache reads
and writes included) and every output token, and the stop reason as
`finishReason` (`end_turn` and `stop_sequence` → `stop`, `tool_use` →
`tool_calls`, `max_tokens` → `length`, anything else → `other`).

## Limits

- **Capabilities:** `tools` only. `jsonOutput` is `false`: the Messages
  API can only guarantee JSON against a schema, and `ChatRequest` carries
  none, so a JSON answer is asked for in words. `vision` is `false` until
  `ChatMessage` carries images. `streaming` is `false` until `stream` is
  added.
- **Spend:** `Usage` has no field for the prompt cache, so cache reads and
  writes count as plain input tokens.
- **Errors** are `AnthropicError` with a short code (`bad-arguments`,
  `not-signed-in`, `not-allowed`, `not-found`, `rate-limited`,
  `unavailable`, `unexpected-response`). Anthropic's own error text is never
  passed on; at most its error type, such as `(overloaded_error)`.
