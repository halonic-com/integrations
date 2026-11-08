import { parseBody, scrubBody } from "../scrub/body.ts";
import { RecordingRefused, type ScrubContext } from "../scrub/context.ts";
import type { HeaderEntry, RecordedBody, RecordedRequest } from "../scrub/exchange.ts";
import { Fakes, SECRET, USER_CONTENT } from "../scrub/fakes.ts";
import { FieldPaths } from "../scrub/field-paths.ts";
import { KnownSecrets } from "../scrub/known-secrets.ts";
import type { ScrubPolicy } from "../scrub/policy.ts";
import { ReportBuilder } from "../scrub/report.ts";

/** Where a body difference is reported from, in the same terms as a `userContent` path. */
const BODY = "request.body";

/**
 * Compares the bodies an integration sends on replay with the recorded ones.
 *
 * A recorded body is scrubbed, so the sent body is scrubbed first, by the
 * same rules and with the integration's policy, and the two are then
 * compared: JSON by value, form data and text (such as a multipart upload)
 * line by line. One instance serves one replay, so stand-ins stay stable
 * across its calls, as they do in a recording.
 */
export class RequestBodies {
  private readonly context: ScrubContext;
  private readonly userContent: FieldPaths;

  constructor(policy: ScrubPolicy) {
    this.context = {
      policy,
      // The replay never adds a key to a body, so there is none to look for.
      knownSecrets: new KnownSecrets([]),
      fakes: new Fakes(),
      report: new ReportBuilder(),
      matchedUserContent: new Set(),
    };
    this.userContent = new FieldPaths(policy.userContent, "request");
  }

  /**
   * Throws when the scrubbed `sent` body differs from the recorded request's.
   *
   * @param formKeyFields - form fields the kit puts the key in; the request doesn't carry them yet
   */
  check(
    recorded: RecordedRequest,
    sent: string | undefined,
    sentHeaders: Readonly<Record<string, string>>,
    formKeyFields: ReadonlySet<string>,
  ): void {
    const scrubbed = this.scrub(sent, contentTypeOf(recorded, sentHeaders), recorded.body);
    const difference = bodyDifference(withoutFormKeys(recorded.body, formKeyFields), scrubbed);
    if (difference !== undefined) {
      throw new Error(`The request body differs from the recording${difference}`);
    }
  }

  private scrub(
    sent: string | undefined,
    headers: readonly HeaderEntry[],
    recorded: RecordedBody,
  ): RecordedBody {
    // A text body in a recording means its content type was allowed when it was recorded.
    const allowed =
      recorded.kind === "text"
        ? [...this.context.policy.allowContentTypes, recorded.contentType]
        : this.context.policy.allowContentTypes;
    try {
      const parsed = parseBody(sent, headers, allowed, BODY);
      return scrubBody(parsed, BODY, this.userContent, this.context);
    } catch (error) {
      if (error instanceof RecordingRefused) {
        throw new Error(
          `The request body can't be read the way the recorder reads it: ${error.message}`,
        );
      }
      throw error;
    }
  }
}

/**
 * The content type a sent body is read by: the request's own, or the
 * recorded one when the request sets none and leaves it to the kit.
 */
function contentTypeOf(
  recorded: RecordedRequest,
  sentHeaders: Readonly<Record<string, string>>,
): HeaderEntry[] {
  const own = Object.entries(sentHeaders).find(([name]) => name.toLowerCase() === "content-type");
  const contentType = own?.[1] ?? recorded.headers["content-type"];
  return contentType === undefined ? [] : [["content-type", contentType]];
}

/** The recorded body without the key fields the kit adds to form data. */
function withoutFormKeys(body: RecordedBody, formKeyFields: ReadonlySet<string>): RecordedBody {
  if (body.kind !== "form") {
    return body;
  }
  const value = body.value.filter(
    ([name, fieldValue]) => !(formKeyFields.has(name) && fieldValue === SECRET),
  );
  return { kind: "form", value };
}

/** Where and how `sent` differs from `recorded`, as the end of a sentence; `undefined` when they match. */
function bodyDifference(recorded: RecordedBody, sent: RecordedBody): string | undefined {
  if (recorded.kind !== sent.kind) {
    return `: the request sends ${bodyKind(sent)}; the recording has ${bodyKind(recorded)}.`;
  }
  if (
    recorded.kind === "text" &&
    sent.kind === "text" &&
    recorded.contentType !== sent.contentType
  ) {
    return `: the request sends ${sent.contentType}; the recording has ${recorded.contentType}.`;
  }
  if (recorded.kind === "form" && sent.kind === "form") {
    return lineDifference(formLines(recorded.value), formLines(sent.value));
  }
  if (recorded.kind === "text" && sent.kind === "text") {
    return lineDifference(recorded.value, sent.value);
  }
  if (recorded.kind === "json" && sent.kind === "json") {
    return valueDifference(recorded.value, sent.value, BODY);
  }
  if (recorded.kind === "sse" && sent.kind === "sse") {
    return valueDifference(recorded.value, sent.value, BODY);
  }
  return undefined;
}

function bodyKind(body: RecordedBody): string {
  switch (body.kind) {
    case "empty":
      return "no body";
    case "json":
      return "JSON";
    case "form":
      return "form data";
    case "text":
      return `text (${body.contentType})`;
    case "sse":
      return "an event stream";
  }
}

/** Form data as `name=value` lines, so it is compared and reported like text. */
function formLines(fields: readonly (readonly [string, string])[]): string {
  return fields.map(([name, value]) => `${name}=${value}`).join("\n");
}

/** The first line that differs. Split on `\n` only, so a missing `\r` shows in the quoted line. */
function lineDifference(recorded: string, sent: string): string | undefined {
  const recordedLines = recorded.split("\n");
  const sentLines = sent.split("\n");
  const count = Math.max(recordedLines.length, sentLines.length);
  for (let index = 0; index < count; index++) {
    const recordedLine = recordedLines[index];
    const sentLine = sentLines[index];
    if (!sameText(recordedLine, sentLine)) {
      const where = ` in line ${index + 1}`;
      return `${where}: the request sends ${shown(sentLine)}; the recording has ${shown(recordedLine)}.${userContentHint(recordedLine, sentLine)}`;
    }
  }
  return undefined;
}

/** The first place, in path notation, where two JSON values differ. Field order doesn't matter. */
function valueDifference(recorded: unknown, sent: unknown, path: string): string | undefined {
  if (Array.isArray(recorded) && Array.isArray(sent)) {
    const count = Math.max(recorded.length, sent.length);
    for (let index = 0; index < count; index++) {
      const difference = valueDifference(recorded[index], sent[index], `${path}[${index}]`);
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }
  if (isFields(recorded) && isFields(sent)) {
    const names = [...new Set([...Object.keys(recorded), ...Object.keys(sent)])].sort();
    for (const name of names) {
      const difference = valueDifference(recorded[name], sent[name], `${path}.${name}`);
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }
  const same =
    typeof recorded === "string" && typeof sent === "string"
      ? sameText(recorded, sent)
      : recorded === sent;
  if (same) {
    return undefined;
  }
  return ` at ${path}: the request sends ${shown(sent)}; the recording has ${shown(recorded)}.${userContentHint(recorded, sent)}`;
}

function isFields(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Two texts match when they are equal apart from the numbers in stand-ins.
 * The recorder numbered stand-ins over requests and responses with the
 * service's own values; a replay only sees the requests, so its numbers can
 * run differently.
 */
function sameText(recorded: string | undefined, sent: string | undefined): boolean {
  if (recorded === undefined || sent === undefined) {
    return recorded === sent;
  }
  return withoutStandInNumbers(recorded) === withoutStandInNumbers(sent);
}

function withoutStandInNumbers(text: string): string {
  return text
    .replace(/scrubbed-secret-\d+/g, "scrubbed-secret-n")
    .replace(/person\d+@example\.com/g, "person-n@example.com")
    .replace(/\+447700900\d{3}/g, "+447700900nnn");
}

function shown(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

/** A hint when the recording has user content where the request has something else. */
function userContentHint(recorded: unknown, sent: unknown): string {
  const placeholder = typeof recorded === "string" && recorded.includes(USER_CONTENT.text);
  if (!placeholder || sent === undefined) {
    return "";
  }
  return " If it is the user's own content, pass the integration's recording policy to replay.";
}
