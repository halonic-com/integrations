import { z } from "zod";

/**
 * The recording file: `integrations/<name>/recordings/<scenario>.json`.
 *
 * This is the one contract shared with the conformance suite, which reads
 * recordings with `recordingFileSchema`. It imports nothing else from this
 * package, so it can move into the kit as it is. A change here needs the
 * same change in the suite's reader, or a new `RECORDING_FORMAT`.
 */

/** Bumped when the file layout changes in a way old readers can't handle. */
export const RECORDING_FORMAT = "halonic.recording/1";

/** Header names in lower case. Headers that change on every run are left out. */
const headersSchema = z.record(z.string().regex(/^[a-z0-9!#$%&'*+.^_`|~-]+$/), z.string());

const streamEventSchema = z.strictObject({
  event: z.string(),
  data: z.json(),
});

/**
 * A body, saved parsed. Anything that isn't one of these kinds was refused
 * when it was recorded. `text` only appears when the integration allows its
 * content type.
 */
const bodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty") }),
  z.strictObject({ kind: z.literal("json"), value: z.json() }),
  z.strictObject({ kind: z.literal("form"), value: z.array(z.tuple([z.string(), z.string()])) }),
  z.strictObject({ kind: z.literal("text"), contentType: z.string(), value: z.string() }),
  z.strictObject({ kind: z.literal("sse"), value: z.array(streamEventSchema) }),
]);

const httpExchangeSchema = z.strictObject({
  transport: z.literal("http"),
  request: z.strictObject({
    method: z.string().regex(/^[A-Z]+$/),
    url: z.url(),
    headers: headersSchema,
    body: bodySchema,
  }),
  response: z.strictObject({
    status: z.int().min(100).max(599),
    headers: headersSchema,
    body: bodySchema,
  }),
});

/**
 * One exchange, tagged by transport. Only `http` today; local MCP programs
 * will add `stdio` (ordered JSON-RPC messages) without a new format version.
 */
const exchangeSchema = z.discriminatedUnion("transport", [httpExchangeSchema]);

/** What the scrubber replaced: the rule, the place and how often. Never a value. */
const reportEntrySchema = z.strictObject({
  rule: z.string(),
  path: z.string(),
  count: z.int().positive(),
});

export const recordingFileSchema = z.strictObject({
  format: z.literal(RECORDING_FORMAT),
  integration: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  scenario: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** In call order: on replay, each call is matched by method, URL and position. */
  exchanges: z.array(exchangeSchema),
  scrubReport: z.array(reportEntrySchema),
});

export type RecordingFile = z.infer<typeof recordingFileSchema>;

/**
 * The exact text of a recording file: keys sorted at every level, indented
 * by 2, with a final line break, so the same recording always gives the same
 * text and diffs stay easy to review. Lists keep their order.
 */
export function formatRecording(file: RecordingFile): string {
  return `${JSON.stringify(sortKeys(file), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => byStringOrder(a, b));
    return Object.fromEntries(entries.map(([key, child]) => [key, sortKeys(child)]));
  }
  return value;
}

/** Plain string order, the same on every machine (unlike `localeCompare`). */
function byStringOrder(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
