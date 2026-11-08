import { RecordingRefused, type ScrubContext } from "./context.ts";
import type { HeaderEntry, JsonValue, RecordedBody } from "./exchange.ts";
import { USER_CONTENT_TEXT } from "./fakes.ts";
import type { FieldPaths } from "./field-paths.ts";
import { scrubJson } from "./json.ts";
import { PLACEHOLDER } from "./patterns.ts";
import { isSecretName } from "./secret-names.ts";
import { scrubText } from "./text.ts";

/**
 * Parses a captured body by its `content-type`. Fails closed: a body that is
 * neither JSON nor form data stops the recording, unless the integration
 * allows its content type as text. A body we can't read is a body we can't
 * scrub.
 */
export function parseBody(
  raw: string | undefined,
  headers: readonly HeaderEntry[],
  allowedTextTypes: readonly string[],
  where: string,
): RecordedBody {
  if (raw === undefined || raw === "") {
    return { type: "empty" };
  }
  const contentType = mediaTypeOf(headers);
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    return { type: "json", value: parseJson(raw, where) };
  }
  if (contentType === "application/x-www-form-urlencoded") {
    return { type: "form", fields: [...new URLSearchParams(raw)] };
  }
  if (allowedTextTypes.includes(contentType)) {
    return { type: "text", contentType, text: raw };
  }
  const shown = contentType === "" ? "no content type" : `content type "${contentType}"`;
  throw new RecordingRefused(
    where,
    `a body with ${shown} can't be scrubbed. If the integration really needs it, allow it with textContentTypes`,
  );
}

/** Applies every rule to a parsed body. */
export function scrubBody(
  body: RecordedBody,
  where: string,
  userContent: FieldPaths,
  context: ScrubContext,
): RecordedBody {
  switch (body.type) {
    case "empty":
      return body;
    case "json":
      return { type: "json", value: scrubJson(body.value, where, userContent, context) };
    case "form":
      return { type: "form", fields: scrubForm(body.fields, where, userContent, context) };
    case "text":
      return { ...body, text: scrubTextBody(body.text, where, userContent, context) };
  }
}

function scrubForm(
  fields: readonly [string, string][],
  where: string,
  userContent: FieldPaths,
  context: ScrubContext,
): [string, string][] {
  return fields.map(([name, value]) => {
    const location = `${where}.${name}`;
    const declared = userContent.match([name]);
    if (declared !== undefined) {
      context.matchedUserContent.add(declared);
      context.report.add("user-content", location);
      return [name, USER_CONTENT_TEXT];
    }
    if (
      !PLACEHOLDER.test(value) &&
      isSecretName(name, "query-or-form", context.policy.secretFields)
    ) {
      context.report.add("secret-field", location);
      return [name, context.fakes.secret(value)];
    }
    return [scrubText(name, location, context), scrubText(value, location, context)];
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
    return USER_CONTENT_TEXT;
  }
  return scrubText(text, where, context);
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
