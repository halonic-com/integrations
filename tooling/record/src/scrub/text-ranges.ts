/** A piece of a string, from `start` up to (not including) `end`. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Replaces the given pieces of `text`. Overlapping or touching pieces are
 * merged first, so a value found by two searches is replaced once.
 */
export function replaceRanges(
  text: string,
  ranges: readonly TextRange[],
  replace: (piece: string) => string,
): string {
  let result = "";
  let position = 0;
  for (const range of mergeRanges(ranges)) {
    result += text.slice(position, range.start) + replace(text.slice(range.start, range.end));
    position = range.end;
  }
  return result + text.slice(position);
}

/** Sorts ranges and merges overlapping or touching ones. */
export function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}
