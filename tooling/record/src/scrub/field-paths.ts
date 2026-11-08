/**
 * The paths an integration uses to point at user-content fields:
 * `messages[].snippet`, `payload.parts[].body.data`, `items[].*`, or `$` for
 * the whole body. See `ScrubPolicy.userContent`.
 */

/** Where a value sits inside a body: field names and list positions. */
export type ValuePath = readonly (string | number)[];

type Step =
  | { readonly kind: "field"; readonly name: string }
  | { readonly kind: "any-field" }
  | { readonly kind: "each-item" };

interface FieldPattern {
  readonly source: string;
  readonly steps: readonly Step[];
}

/** A set of declared paths, ready to match against positions in a body. */
export class FieldPaths {
  private readonly patterns: readonly FieldPattern[];

  constructor(sources: readonly string[]) {
    this.patterns = sources.map((source) => ({ source, steps: parsePath(source) }));
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

function parsePath(source: string): Step[] {
  if (source === "$") {
    return [];
  }
  const steps: Step[] = [];
  for (const part of source.split(".")) {
    const name = part.replace(/(\[\])+$/, "");
    if (name === "*") {
      steps.push({ kind: "any-field" });
    } else if (name !== "") {
      steps.push({ kind: "field", name });
    }
    const listDepth = (part.length - name.length) / 2;
    for (let i = 0; i < listDepth; i += 1) {
      steps.push({ kind: "each-item" });
    }
  }
  return steps;
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
  }
}
