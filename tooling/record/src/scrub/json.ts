import { type ScrubContext, secretStandIn } from "./context.ts";
import type { JsonValue } from "./exchange.ts";
import { USER_CONTENT } from "./fakes.ts";
import { type FieldPaths, formatPath, type ValuePath } from "./field-paths.ts";
import { PLACEHOLDER } from "./patterns.ts";
import { isSecretName, jsonFieldKind } from "./secret-names.ts";
import { scrubText } from "./text.ts";

/**
 * Scrubs a parsed JSON value. Walks every value and applies, in order:
 * 1. declared user-content paths: the whole value becomes a placeholder of the same type.
 *    A string that holds JSON stays JSON, with the placeholders inside it
 * 2. secret-like field names: every string in the value, also inside a
 *    list or object, becomes a secret stand-in (numbers stay, so
 *    `max_tokens: 1024` survives)
 * 3. the free-text rules on every other string, and on field names too
 *    (some APIs key maps by e-mail address)
 *
 * @param at - where the value sits in the body; a stream event's data starts at `[n, "data"]`
 */
export function scrubJson(
  value: JsonValue,
  where: string,
  userContent: FieldPaths,
  context: ScrubContext,
  at: ValuePath = [],
): JsonValue {
  return new JsonWalk(where, userContent, context).visit(value, at);
}

class JsonWalk {
  private readonly where: string;
  private readonly userContent: FieldPaths;
  private readonly context: ScrubContext;

  constructor(where: string, userContent: FieldPaths, context: ScrubContext) {
    this.where = where;
    this.userContent = userContent;
    this.context = context;
  }

  /**
   * @param secret - true below a field named like a secret: every string in
   *   it, however deep, becomes a secret stand-in
   */
  visit(value: JsonValue, path: ValuePath, secret = false): JsonValue {
    const declared = this.userContent.match(path);
    if (declared !== undefined) {
      this.markUserContent(declared, path, value);
      return asUserContent(value);
    }
    if (typeof value === "string") {
      return secret ? this.replaceSecret(value, path) : this.visitString(value, path);
    }
    if (Array.isArray(value) || (value !== null && typeof value === "object")) {
      return this.visitContainer(value, path, secret);
    }
    return value;
  }

  /**
   * When a declared path goes on past this list or object but the value has
   * another shape than the path expects (a list where it wants fields, or
   * fields where it wants a list), the path can't reach its content, so all of
   * it becomes user content. Model-written JSON has no fixed shape, so this
   * can happen at any depth.
   */
  private visitContainer(
    value: JsonValue[] | { [key: string]: JsonValue },
    path: ValuePath,
    secret: boolean,
  ): JsonValue {
    const unreachable = this.userContent.cannotEnter(path, value);
    if (unreachable !== undefined) {
      this.markUserContent(unreachable, path, value);
      return asUserContent(value);
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => this.visit(item, [...path, index], secret));
    }
    return this.visitObject(value, path, secret);
  }

  private visitObject(
    value: { [key: string]: JsonValue },
    path: ValuePath,
    secret: boolean,
  ): JsonValue {
    const result: { [key: string]: JsonValue } = {};
    const kind = jsonFieldKind(value);
    for (const [key, child] of Object.entries(value)) {
      // The key is scrubbed first and the path uses the scrubbed key, so the
      // report in the file never holds an address that was used as a key.
      const scrubbedKey = scrubText(key, this.locate(path), this.context);
      const childSecret = secret || isSecretName(key, kind, this.context.policy.secretFields);
      result[scrubbedKey] = this.visit(child, [...path, scrubbedKey], childSecret);
    }
    return result;
  }

  private replaceSecret(value: string, path: ValuePath): string {
    if (PLACEHOLDER.test(value)) {
      return value;
    }
    this.context.report.add("secret-field", this.locate(path));
    return secretStandIn(value, this.context);
  }

  /**
   * A string that is itself JSON (some APIs nest it, such as OpenAI's tool
   * arguments) is scrubbed as JSON at the same path, so the field-name rules
   * and declared paths still apply inside it, including the shape check in
   * `visitContainer`.
   */
  private visitString(value: string, path: ValuePath): string {
    const nested = parseNestedJson(value);
    if (nested === undefined) {
      return this.visitPlainString(value, path);
    }
    const scrubbed = this.visit(nested, path);
    const unchanged = JSON.stringify(scrubbed) === JSON.stringify(nested);
    return unchanged ? value : JSON.stringify(scrubbed);
  }

  /**
   * A declared path that goes on inside this string expects JSON. When the
   * string isn't JSON (tool arguments cut off at the token limit), the path
   * can't reach its content, so the whole string is user content instead of
   * being kept as text.
   */
  private visitPlainString(value: string, path: ValuePath): string {
    const declared = this.userContent.reachesInside(path);
    if (declared !== undefined) {
      this.markUserContent(declared, path, value);
      // Empty stays empty, as in `asUserContent`.
      return value === "" ? value : USER_CONTENT.text;
    }
    return scrubText(value, this.locate(path), this.context);
  }

  /**
   * The declared path matched, so it isn't reported as unused. An empty
   * string stays as it is (see `asUserContent`), so nothing was replaced and
   * the report leaves it out.
   */
  private markUserContent(declared: string, path: ValuePath, value: JsonValue): void {
    this.context.matchedUserContent.add(declared);
    if (value !== "") {
      this.context.report.add("user-content", this.locate(path));
    }
  }

  private locate(path: ValuePath): string {
    const formatted = formatPath(path);
    if (formatted === "") {
      return this.where;
    }
    return formatted.startsWith("[") ? `${this.where}${formatted}` : `${this.where}.${formatted}`;
  }
}

/**
 * The same shape with every leaf replaced by a fixed value of its type. A
 * string that holds JSON gets the same treatment inside, so it still parses
 * on replay: an integration that reads it must not fail on the recording.
 *
 * An empty string holds no content, so it stays empty. This keeps the empty
 * pieces of joined streamed JSON (`streamed-json.ts`) empty, so the pieces
 * still join to the scrubbed JSON in the first one.
 */
function asUserContent(value: JsonValue): JsonValue {
  if (value === "") {
    return value;
  }
  if (typeof value === "string") {
    const nested = parseNestedJson(value);
    return nested === undefined ? USER_CONTENT.text : JSON.stringify(asUserContent(nested));
  }
  if (typeof value === "number") {
    return USER_CONTENT.number;
  }
  if (typeof value === "boolean") {
    return USER_CONTENT.boolean;
  }
  if (Array.isArray(value)) {
    return value.map(asUserContent);
  }
  if (value !== null) {
    // Field names inside user content can be content too (a map keyed by
    // subject line), so they are numbered instead of kept.
    return Object.fromEntries(
      Object.values(value).map((child, index) => [`field-${index + 1}`, asUserContent(child)]),
    );
  }
  return null;
}

/** The JSON a string holds, when it holds an object or a list; `undefined` otherwise. */
export function parseNestedJson(value: string): JsonValue | undefined {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return undefined;
  }
}
