import { RecordingRefused, type ScrubContext, secretStandIn } from "./context.ts";
import { parseEventStream } from "./event-stream.ts";
import type { HeaderEntry, JsonValue, RecordedBody, StreamEvent } from "./exchange.ts";
import { USER_CONTENT } from "./fakes.ts";
import type { FieldPaths } from "./field-paths.ts";
import { scrubJson } from "./json.ts";
import { PLACEHOLDER } from "./patterns.ts";
import { isSecretName } from "./secret-names.ts";
import { scrubText } from "./text.ts";

/*
 * The replay imports this file, and integration tests typecheck it with the
 * integration preset, which has no Web or Node globals. Node and the cloud
 * runtimes all have these, so only the parts used here are declared.
 */
declare const URLSearchParams: new (text: string) => Iterable<[string, string]>;

/**
 * Parses a captured body by its `content-type`. Fails closed: a body that is
 * not JSON, form data or an event stream stops the recording, unless the
 * integration allows its content type as text. A body we can't read is a
 * body we can't scrub.
 */
export function parseBody(
  raw: string | undefined,
  headers: readonly HeaderEntry[],
  allowContentTypes: readonly string[],
  where: string,
): RecordedBody {
  if (raw === undefined || raw === "") {
    return { kind: "empty" };
  }
  const contentType = mediaTypeOf(headers);
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    return { kind: "json", value: parseJson(raw, where) };
  }
  if (contentType === "application/x-www-form-urlencoded") {
    return { kind: "form", value: [...new URLSearchParams(raw)] };
  }
  if (contentType === "text/event-stream") {
    return { kind: "sse", value: parseEventStream(raw) };
  }
  if (allowContentTypes.includes(contentType)) {
    return { kind: "text", contentType, value: raw };
  }
  const shown = contentType === "" ? "no content type" : `content type "${contentType}"`;
  throw new RecordingRefused(
    where,
    `a body with ${shown} can't be scrubbed. If the integration really needs it, allow it with recording.allowContentTypes`,
  );
}

/** Applies every rule to a parsed body. */
export function scrubBody(
  body: RecordedBody,
  where: string,
  userContent: FieldPaths,
  context: ScrubContext,
): RecordedBody {
  switch (body.kind) {
    case "empty":
      return body;
    case "json":
      return { kind: "json", value: scrubJson(body.value, where, userContent, context) };
    case "form":
      return { kind: "form", value: scrubForm(body.value, where, userContent, context) };
    case "text":
      return { ...body, value: scrubTextBody(body.value, where, userContent, context) };
    case "sse":
      return { kind: "sse", value: scrubEvents(body.value, where, userContent, context) };
  }
}

function scrubForm(
  fields: readonly [string, string][],
  where: string,
  userContent: FieldPaths,
  context: ScrubContext,
): [string, string][] {
  return fields.map(([rawName, value]) => {
    // The name is scrubbed first, so the report never holds an address used as a name.
    const name = scrubText(rawName, where, context);
    const location = `${where}.${name}`;
    const declared = userContent.match([rawName]);
    if (declared !== undefined) {
      context.matchedUserContent.add(declared);
      context.report.add("user-content", location);
      return [name, USER_CONTENT.text];
    }
    if (
      !PLACEHOLDER.test(value) &&
      isSecretName(rawName, "query-or-form", context.policy.secretFields)
    ) {
      context.report.add("secret-field", location);
      return [name, secretStandIn(value, context)];
    }
    return [name, scrubText(value, location, context)];
  });
}

function scrubTextBody(
  text: string,
  where: string,
  userContent: FieldPaths,
  context: ScrubContext,
): string {
  const declared = userContent.match([]);
  if (declared !== undefined) {
    context.matchedUserContent.add(declared);
    context.report.add("user-content", where);
    return USER_CONTENT.text;
  }
  return scrubText(text, where, context);
}

/**
 * Each event's data is scrubbed like a JSON body that starts at
 * `[n].data`, so `response.body[*].data.delta.text` points at the streamed
 * text of every event. The event name goes through the text rules.
 */
function scrubEvents(
  events: readonly StreamEvent[],
  where: string,
  userContent: FieldPaths,
  context: ScrubContext,
): StreamEvent[] {
  return events.map((event, index) => {
    const data: JsonValue = scrubJson(event.data, where, userContent, context, [index, "data"]);
    return { event: scrubText(event.event, `${where}[${index}].event`, context), data };
  });
}

/** `application/json; charset=utf-8` becomes `application/json`. */
function mediaTypeOf(headers: readonly HeaderEntry[]): string {
  const header = headers.find(([name]) => name.toLowerCase() === "content-type");
  return (header?.[1].split(";")[0] ?? "").trim().toLowerCase();
}

function parseJson(raw: string, where: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    throw new RecordingRefused(where, "the body says it is JSON but doesn't parse");
  }
}
