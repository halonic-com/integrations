import { RecordingRefused } from "./context.ts";
import type { JsonValue } from "./exchange.ts";
import { isQueryPath } from "./query-paths.ts";

/**
 * The paths an integration uses to point at user-content fields, such as
 * `response.body.messages[*].snippet`. See `ScrubPolicy.userContent`.
 *
 * Our own small syntax, no library: a side (`request.body` or
 * `response.body`), then `.name` for a field, `.*` for any field name, `[*]`
 * for every item of a list and `[n]` for one item.
 *
 * A path may go on inside a string that holds JSON, such as OpenAI's tool
 * arguments: `response.body.choices[*].message.tool_calls[*].function.arguments.*`.
 * The steps after the string are matched against the JSON in it.
 */

/** Where a value sits inside a body: field names and list positions. */
export type ValuePath = readonly (string | number)[];

export type BodySide = "request" | "response";

type Step =
  | { readonly kind: "field"; readonly name: string }
  | { readonly kind: "any-field" }
  | { readonly kind: "each-item" }
  | { readonly kind: "item"; readonly index: number };

interface FieldPattern {
  readonly source: string;
  readonly steps: readonly Step[];
}

/** One step after the side: `.name`, `.*`, `[*]` or `[3]`. */
const STEP = /\.([^.[\]]+)|\[(\*|\d+)\]/y;

/** The declared paths for one side of an exchange, ready to match against positions in a body. */
export class FieldPaths {
  private readonly patterns: readonly FieldPattern[];

  /**
   * Keeps the paths that start at `<side>.body`. Throws `RecordingRefused`
   * for a path it can't read: a path that silently matched nothing would
   * leave content in the file that was meant to be removed. Query paths
   * (`request.query.q`) are left to `QueryPaths`.
   *
   * @param section - the `recording` field the paths come from, for errors
   */
  constructor(sources: readonly string[], side: BodySide, section = "userContent") {
    this.patterns = sources
      .filter((source) => !isQueryPath(source))
      .map((source) => ({ source, parsed: parsePath(source, section) }))
      .filter(({ parsed }) => parsed.side === side)
      .map(({ source, parsed }) => ({ source, steps: parsed.steps }));
  }

  /** The declared path that points exactly at `path`, if any. */
  match(path: ValuePath): string | undefined {
    return this.patterns.find((pattern) => matchesSteps(pattern.steps, path))?.source;
  }

  /**
   * The declared path that goes on past `path`, if any. For a string, that
   * means the path expects JSON inside it.
   */
  reachesInside(path: ValuePath): string | undefined {
    return this.reachingInside(path)[0]?.source;
  }

  /**
   * The declared path that goes on past `path` but can't take its next step
   * into `value`: a field step meets something that isn't an object, or a
   * list step meets something that isn't a list. Whatever `value` holds
   * would then be missed by that path.
   *
   * The body itself is the exception, when another declared path can enter
   * it. One service can answer as a JSON object or as an event stream (a
   * list of events), as an MCP server does, so its sheet has paths for
   * both: `response.body.result` and `response.body[*].data.result`. Each
   * body takes one kind, and the other kind's paths have nothing to miss.
   */
  cannotEnter(path: ValuePath, value: JsonValue): string | undefined {
    const reaching = this.reachingInside(path);
    const blocked = reaching.filter((pattern) => {
      const next = pattern.steps[path.length];
      return next !== undefined && !canEnter(next, value);
    });
    const isBody = path.length === 0;
    if (isBody && blocked.length < reaching.length) {
      return undefined;
    }
    return blocked[0]?.source;
  }

  private reachingInside(path: ValuePath): readonly FieldPattern[] {
    return this.patterns.filter(
      (pattern) =>
        pattern.steps.length > path.length &&
        matchesSteps(pattern.steps.slice(0, path.length), path),
    );
  }
}

/** Formats a position for reports: `messages[0].snippet`. */
export function formatPath(path: ValuePath): string {
  return path
    .map((step, index) => {
      if (typeof step === "number") {
        return `[${step}]`;
      }
      return index === 0 ? step : `.${step}`;
    })
    .join("");
}

function parsePath(source: string, section: string): { side: BodySide; steps: Step[] } {
  const side = sideOf(source, section);
  const rest = source.slice(`${side}.body`.length);
  const steps: Step[] = [];
  STEP.lastIndex = 0;
  while (STEP.lastIndex < rest.length) {
    const start = STEP.lastIndex;
    const found = STEP.exec(rest);
    if (found === null) {
      throw unreadable(source, section, `it can't be read from "${rest.slice(start)}"`);
    }
    steps.push(toStep(found[1], found[2]));
  }
  return { side, steps };
}

function sideOf(source: string, section: string): BodySide {
  if (source.startsWith("request.body")) {
    return "request";
  }
  if (source.startsWith("response.body")) {
    return "response";
  }
  throw unreadable(
    source,
    section,
    "it must start with request.body, response.body or request.query",
  );
}

function toStep(field: string | undefined, item: string | undefined): Step {
  if (field !== undefined) {
    return field === "*" ? { kind: "any-field" } : { kind: "field", name: field };
  }
  return item === "*" ? { kind: "each-item" } : { kind: "item", index: Number(item) };
}

/** Exported for `StreamedJson`, which refuses paths outside an event's data the same way. */
export function unreadable(source: string, section: string, reason: string): RecordingRefused {
  return new RecordingRefused(`recording.${section}`, `the path "${source}" is unclear: ${reason}`);
}

function matchesSteps(steps: readonly Step[], path: ValuePath): boolean {
  return (
    steps.length === path.length && steps.every((step, index) => matchesStep(step, path[index]))
  );
}

function canEnter(step: Step, value: JsonValue): boolean {
  const isList = Array.isArray(value);
  const isObject = value !== null && typeof value === "object" && !isList;
  switch (step.kind) {
    case "field":
    case "any-field":
      return isObject;
    case "each-item":
    case "item":
      return isList;
  }
}

function matchesStep(step: Step, actual: string | number | undefined): boolean {
  switch (step.kind) {
    case "field":
      return actual === step.name;
    case "any-field":
      return typeof actual === "string";
    case "each-item":
      return typeof actual === "number";
    case "item":
      return actual === step.index;
  }
}
