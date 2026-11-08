# @halonicjs/integration-shared

A library, not an integration: code that integrations of **different
providers** need, such as reading a streamed answer. It has no permission
sheet, no tools and no `Integration`. Code shared by one provider's
services goes in that provider's own `shared/` folder instead, such as
`tools/google/shared`.

- **Layer:** integrations
- **Owner:** ravi

## What it holds

| Export                   | What                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `EventStream`            | reads server-sent events (`text/event-stream`) from a response body, piece by piece |
| `EventStreamError`       | `too-large` or `bad-encoding`; map it to your own `unexpected-response`             |
| `HttpClient` and friends | a local stand-in for the kit's `HttpClient` type, until the kit is published        |
| `cutText`                | cuts a text to a limit, ending with `…`, never in the middle of a character         |

`EventStream` is used by the model providers that stream and by our MCP
client. It keeps only the unfinished line and the event being built, never
the whole stream, and refuses an event above `maxEventBytes` (1 MiB by
default). Leaving a `for await` loop early cancels the stream. A dropped
connection passes through unchanged, and `lastEventId` tells you where to
resume.

```ts
const events = new EventStream(response.body);
for await (const event of events) {
  if (event.type === "message") handle(event.data);
}
```

## Until the kit is published

`src/http-client.ts` copies the shape of the `HttpClient` port in the main
repo, narrowed to what we use, because the integration TypeScript preset
has no Web types. When `@halonicjs/integration-kit` is published (HAL-135),
delete that file and import `HttpClient` from the kit. `src/utf8.ts`
decodes UTF-8 for the same reason: the preset has no `TextDecoder`.

If every integration ends up needing `EventStream`, it moves to the kit
(guide, section 8).
