/**
 * Reads chosen top-level fields of a permission sheet (`integration.yaml`).
 *
 * The repo has no YAML library (plan 7.1), so this reads the small part of
 * YAML the sheets use: block mappings and lists, one-line `[...]` and
 * `{...}`, plain and quoted scalars, folded `>` text and comments. Only the
 * fields a rule asks for are read, so the rest of the sheet may use more.
 * Anything else in those fields throws a `SheetSyntaxError` instead of
 * being read wrong.
 */

/** A value read from the sheet. Scalars stay text: the rules compare text. */
export type SheetValue = string | null | readonly SheetValue[] | SheetMapping;

/** A mapping read from the sheet, in the order the sheet writes it. */
export interface SheetMapping {
  readonly [key: string]: SheetValue;
}

/** A top-level field and the line its key is on. */
export interface SheetField {
  readonly line: number;
  readonly value: SheetValue;
}

/** Thrown when a field uses YAML this reader doesn't cover. */
export class SheetSyntaxError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(message);
    this.line = line;
  }
}

/** One line with content, without its comment. */
interface Line {
  readonly number: number;
  readonly indent: number;
  readonly text: string;
}

/** `key: rest` or `key:`; a colon followed by text (as in a URL) is no key. */
const keyPattern = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/;

/** Reads the given top-level fields; a field the sheet leaves out is missing from the result. */
export function readSheetFields(
  text: string,
  names: readonly string[],
): ReadonlyMap<string, SheetField> {
  const fields = new Map<string, SheetField>();
  const lines = contentLines(text);
  for (const [index, line] of lines.entries()) {
    const key = line.indent === 0 ? keyPattern.exec(line.text) : null;
    if (key === null || !names.includes(key[1] as string)) {
      continue;
    }
    const end = lines.findIndex((other, at) => at > index && other.indent === 0);
    const body = lines.slice(index + 1, end === -1 ? lines.length : end);
    fields.set(key[1] as string, { line: line.number, value: readValue(line, key[2], body) });
  }
  return fields;
}

/** The lines that hold something, with comments and trailing spaces removed. */
function contentLines(text: string): Line[] {
  const lines: Line[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    const content = withoutComment(raw).trimEnd();
    if (content.trim() === "") {
      continue;
    }
    const indent = content.length - content.trimStart().length;
    lines.push({ number: index + 1, indent, text: content.trimStart() });
  }
  return lines;
}

/** Cuts a `#` comment that starts a line or follows a space, outside quotes. */
function withoutComment(line: string): string {
  const quotes = new QuoteTracker();
  for (let at = 0; at < line.length; at += 1) {
    if (
      quotes.step(line, at) &&
      line[at] === "#" &&
      (at === 0 || /\s/.test(line[at - 1] as string))
    ) {
      return line.slice(0, at);
    }
  }
  return line;
}

/**
 * Follows quoted scalars through a line. A quote opens one only where a
 * value starts, so the apostrophe in `doesn't` is plain text, and `''`
 * inside single quotes is an escaped quote.
 */
class QuoteTracker {
  private quote: string | null = null;
  private skipNext = false;

  /** Moves past the character at `at`; true when it is outside quotes. */
  step(text: string, at: number): boolean {
    const char = text[at] as string;
    if (this.skipNext) {
      this.skipNext = false;
      return false;
    }
    if (this.quote === null) {
      const previous = at === 0 ? " " : (text[at - 1] as string);
      if ((char === "'" || char === '"') && /[\s[{,]/.test(previous)) {
        this.quote = char;
        return false;
      }
      return true;
    }
    if (char === "\\" && this.quote === '"') {
      this.skipNext = true;
    } else if (char === "'" && this.quote === "'" && text[at + 1] === "'") {
      this.skipNext = true;
    } else if (char === this.quote) {
      this.quote = null;
    }
    return false;
  }
}

/** The value of `key: inline` with the more indented lines below it. */
function readValue(keyLine: Line, inline: string | undefined, body: readonly Line[]): SheetValue {
  if (inline === undefined) {
    return body.length === 0 ? null : readBlock(body);
  }
  if (inline === ">" || inline === ">-") {
    return body.map((line) => line.text).join(" ");
  }
  const value = readInline(inline, keyLine.number);
  if (body.length > 0) {
    throw new SheetSyntaxError(
      body[0]?.number ?? keyLine.number,
      "This line belongs to a value that is already written on the line above.",
    );
  }
  return value;
}

/** A block list (lines starting with `-`) or a block mapping (`key: value` lines). */
function readBlock(lines: readonly Line[]): SheetValue {
  const first = lines[0] as Line;
  const outdented = lines.find((line) => line.indent < first.indent);
  if (outdented !== undefined) {
    throw new SheetSyntaxError(outdented.number, "This line is indented less than the one above.");
  }
  return first.text === "-" || first.text.startsWith("- ")
    ? readBlockList(lines, first.indent)
    : readBlockMapping(lines, first.indent);
}

function readBlockList(lines: readonly Line[], indent: number): SheetValue[] {
  const items: Line[][] = [];
  for (const line of lines) {
    if (line.indent > indent) {
      items.at(-1)?.push(line);
      continue;
    }
    if (line.text !== "-" && !line.text.startsWith("- ")) {
      throw new SheetSyntaxError(line.number, 'Start every entry of this list with "- ".');
    }
    const rest = line.text.slice(1).trimStart();
    const restIndent = indent + line.text.length - rest.length;
    items.push(rest === "" ? [] : [{ number: line.number, indent: restIndent, text: rest }]);
  }
  return items.map((item) => {
    const first = item[0];
    if (first === undefined) {
      return null;
    }
    return keyPattern.test(first.text)
      ? readBlock(item)
      : readValue(first, first.text, item.slice(1));
  });
}

function readBlockMapping(lines: readonly Line[], indent: number): SheetMapping {
  const mapping: Record<string, SheetValue> = {};
  for (const [index, line] of lines.entries()) {
    if (line.indent > indent) {
      continue;
    }
    const key = keyPattern.exec(line.text);
    if (key === null) {
      throw new SheetSyntaxError(line.number, 'Write this line as "key: value".');
    }
    const end = lines.findIndex((other, at) => at > index && other.indent <= indent);
    const body = lines.slice(index + 1, end === -1 ? lines.length : end);
    mapping[key[1] as string] = readValue(line, key[2], body);
  }
  return mapping;
}

/** A value written on one line: `[...]`, `{...}`, a quoted or a plain scalar. */
function readInline(text: string, line: number): SheetValue {
  if (text.startsWith("[")) {
    return splitFlow(text, "]", line).map((part) => readInline(part, line));
  }
  if (text.startsWith("{")) {
    const mapping: Record<string, SheetValue> = {};
    for (const part of splitFlow(text, "}", line)) {
      const key = keyPattern.exec(part);
      if (key === null) {
        throw new SheetSyntaxError(line, `Write "${part}" as "key: value".`);
      }
      mapping[key[1] as string] = key[2] === undefined ? null : readInline(key[2], line);
    }
    return mapping;
  }
  if (/^[&*!|%@`]/.test(text)) {
    throw new SheetSyntaxError(
      line,
      `${text} uses an anchor, alias, tag or block text; write the value out instead.`,
    );
  }
  if (text.startsWith('"')) {
    return readQuoted(text, line, () => JSON.parse(text) as string);
  }
  if (text.startsWith("'")) {
    return readQuoted(text, line, () => text.slice(1, -1).replaceAll("''", "'"));
  }
  return text;
}

function readQuoted(text: string, line: number, unquote: () => string): string {
  try {
    if (text.length >= 2 && text.endsWith(text[0] as string)) {
      return unquote();
    }
  } catch {
    // Falls through to the error below.
  }
  throw new SheetSyntaxError(line, `Close the quotes in ${text}.`);
}

/** The comma-separated parts of a one-line `[...]` or `{...}`, nested brackets kept whole. */
function splitFlow(text: string, close: string, line: number): string[] {
  if (!text.endsWith(close)) {
    throw new SheetSyntaxError(line, `Close ${text[0]} on the same line with ${close}.`);
  }
  const inner = text.slice(1, -1);
  const quotes = new QuoteTracker();
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let at = 0; at < inner.length; at += 1) {
    const char = inner[at] as string;
    if (quotes.step(inner, at)) {
      if (char === "[" || char === "{") {
        depth += 1;
      } else if (char === "]" || char === "}") {
        depth -= 1;
      } else if (char === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter((part) => part !== "");
}
