import type { JsonValue, RecordedBody, StreamEvent } from "./exchange.ts";
import { FieldPaths, unreadable, type ValuePath } from "./field-paths.ts";

/** Where every `streamedJson` path starts: the data of each event. */
const EVENT_DATA = "response.body[*].data";

/** One piece of streamed JSON text, where it sits and which text it is part of. */
interface Piece {
  /** Where the piece sits in the body, starting at `[n, "data"]`. */
  readonly path: ValuePath;
  readonly text: string;
  /** The declared path and the `index` values along the way: pieces with the same group join. */
  readonly group: string;
}

/**
 * Joins the pieces of JSON text that an event stream sends one by one, such
 * as a streamed tool call's arguments (`ScrubPolicy.streamedJson`). No piece
 * parses on its own, so a rule applied to each piece would break the JSON:
 * a placeholder per piece no longer joins to anything that parses on replay.
 *
 * Instead each text is joined into its first piece and the other pieces
 * become empty strings. The pieces still join to the same text, and the
 * scrubber's other rules then see complete JSON in the first piece, so a
 * `userContent` path such as `...partial_json.*` keeps the field names as it
 * does for JSON that came whole.
 */
export class StreamedJson {
  private readonly paths: FieldPaths;

  /** Throws `RecordingRefused` for a path that doesn't start at an event's data. */
  constructor(sources: readonly string[]) {
    for (const source of sources) {
      if (!source.startsWith(EVENT_DATA)) {
        throw unreadable(source, "streamedJson", `it must start with ${EVENT_DATA}`);
      }
    }
    this.paths = new FieldPaths(sources, "response", "streamedJson");
  }

  /** The body with the pieces joined. Bodies other than event streams stay as they are. */
  join(body: RecordedBody): RecordedBody {
    if (body.kind !== "sse") {
      return body;
    }
    const pieces = body.value.flatMap((event, index) =>
      this.findPieces(event.data, [index, "data"], []),
    );
    const joined = joinGroups(pieces);
    if (joined.size === 0) {
      return body;
    }
    return { kind: "sse", value: body.value.map((event, index) => rewrite(event, index, joined)) };
  }

  /**
   * The pieces in one event's data. `indexes` collects the `index` field of
   * every object on the way down, which tells the texts apart: two tool
   * calls in one answer have different indexes, the pieces of one share them.
   */
  private findPieces(value: JsonValue, path: ValuePath, indexes: readonly number[]): Piece[] {
    const declared = this.paths.match(path);
    if (declared !== undefined) {
      return typeof value === "string"
        ? [{ path, text: value, group: `${declared} ${indexes.join("/")}` }]
        : [];
    }
    if (this.paths.reachesInside(path) === undefined) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => this.findPieces(item, [...path, index], indexes));
    }
    if (value !== null && typeof value === "object") {
      const own = typeof value["index"] === "number" ? [...indexes, value["index"]] : indexes;
      return Object.entries(value).flatMap(([name, child]) =>
        this.findPieces(child, [...path, name], own),
      );
    }
    return [];
  }
}

/**
 * The new text of every piece, by `keyOf` its path: the joined text for
 * the first piece of a group and an empty string for the others. A text that
 * came in one piece needs no change, so it isn't listed.
 */
function joinGroups(pieces: readonly Piece[]): Map<string, string> {
  const groups = new Map<string, Piece[]>();
  for (const piece of pieces) {
    groups.set(piece.group, [...(groups.get(piece.group) ?? []), piece]);
  }
  const replacements = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const text = group.map((piece) => piece.text).join("");
    group.forEach((piece, position) => {
      replacements.set(keyOf(piece.path), position === 0 ? text : "");
    });
  }
  return replacements;
}

function rewrite(
  event: StreamEvent,
  index: number,
  replacements: Map<string, string>,
): StreamEvent {
  return { ...event, data: rewriteValue(event.data, [index, "data"], replacements) };
}

function rewriteValue(
  value: JsonValue,
  path: ValuePath,
  replacements: Map<string, string>,
): JsonValue {
  const replacement = replacements.get(keyOf(path));
  if (replacement !== undefined) {
    return replacement;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => rewriteValue(item, [...path, index], replacements));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => [
        name,
        rewriteValue(child, [...path, name], replacements),
      ]),
    );
  }
  return value;
}

/** A map key for a path. Unlike `formatPath`, a field name with a dot in it can't pass for two steps. */
function keyOf(path: ValuePath): string {
  return JSON.stringify(path);
}
