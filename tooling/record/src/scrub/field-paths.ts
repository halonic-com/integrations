import { RecordingRefused } from "./context.ts";

/**
 * The paths an integration uses to point at user-content fields, such as
 * `response.body.messages[*].snippet`. See `ScrubPolicy.userContent`.
 *
 * Our own small syntax, no library: a side (`request.body` or
 * `response.body`), then `.name` for a field, `.*` for any field name, `[*]`
 * for every item of a list and `[n]` for one item.
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
   * leave content in the file that was meant to be removed.
   */
  constructor(sources: readonly string[], side: BodySide) {
    this.patterns = sources
      .map((source) => ({ source, parsed: parsePath(source) }))
      .filter(({ parsed }) => parsed.side === side)
      .map(({ source, parsed }) => ({ source, steps: parsed.steps }));
  }

  /** The declared path that points exactly at `path`, if any. */
  match(path: ValuePath): string | undefined {
    return this.patterns.find((pattern) => matchesSteps(pattern.steps, path))?.source;
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

function parsePath(source: string): { side: BodySide; steps: Step[] } {
  const side = sideOf(source);
  const rest = source.slice(`${side}.body`.length);
  const steps: Step[] = [];
  STEP.lastIndex = 0;
  while (STEP.lastIndex < rest.length) {
    const start = STEP.lastIndex;
    const found = STEP.exec(rest);
    if (found === null) {
      throw unreadable(source, `it can't be read from "${rest.slice(start)}"`);
    }
    steps.push(toStep(found[1], found[2]));
  }
  return { side, steps };
}

function sideOf(source: string): BodySide {
  if (source.startsWith("request.body")) {
    return "request";
  }
  if (source.startsWith("response.body")) {
    return "response";
  }
  throw unreadable(source, "it must start with request.body or response.body");
}

function toStep(field: string | undefined, item: string | undefined): Step {
  if (field !== undefined) {
    return field === "*" ? { kind: "any-field" } : { kind: "field", name: field };
  }
  return item === "*" ? { kind: "each-item" } : { kind: "item", index: Number(item) };
}

function unreadable(source: string, reason: string): RecordingRefused {
  return new RecordingRefused(
    "recording.userContent",
    `the path "${source}" is unclear: ${reason}`,
  );
}

function matchesSteps(steps: readonly Step[], path: ValuePath): boolean {
  return (
    steps.length === path.length && steps.every((step, index) => matchesStep(step, path[index]))
  );
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
