import { sameText } from "./compare-text.ts";

/** The first place where two JSON values differ, and what each has there. */
export interface ValueDifference {
  /** In path notation, such as `request.body.items[0].name`. */
  readonly path: string;
  readonly recorded: unknown;
  readonly other: unknown;
}

/**
 * The first place, in path notation, where `other` differs from `recorded`.
 * Field order doesn't matter, and texts match when only their stand-in
 * numbers differ (see `sameText`).
 */
export function firstDifference(
  recorded: unknown,
  other: unknown,
  path: string,
): ValueDifference | undefined {
  if (Array.isArray(recorded) && Array.isArray(other)) {
    const count = Math.max(recorded.length, other.length);
    for (let index = 0; index < count; index++) {
      const difference = firstDifference(recorded[index], other[index], `${path}[${index}]`);
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }
  if (isFields(recorded) && isFields(other)) {
    const names = [...new Set([...Object.keys(recorded), ...Object.keys(other)])].sort();
    for (const name of names) {
      const difference = firstDifference(recorded[name], other[name], `${path}.${name}`);
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }
  const same =
    typeof recorded === "string" && typeof other === "string"
      ? sameText(recorded, other)
      : recorded === other;
  return same ? undefined : { path, recorded, other };
}

function isFields(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
