import type { ScrubContext } from "./context.ts";
import type { JsonValue } from "./exchange.ts";
import { USER_CONTENT_TEXT } from "./fakes.ts";
import { type FieldPaths, formatPath, type ValuePath } from "./field-paths.ts";
import { PLACEHOLDER } from "./patterns.ts";
import { isSecretName } from "./secret-names.ts";
import { scrubText } from "./text.ts";

/**
 * Scrubs a parsed JSON body. Walks every value and applies, in order:
 * 1. declared user-content paths: the whole value becomes a placeholder of the same type
 * 2. secret-like field names: a string value becomes a secret stand-in
 *    (numbers stay, so `max_tokens: 1024` survives)
 * 3. the free-text rules on every other string, and on field names too
 *    (some APIs key maps by e-mail address)
 */
export function scrubJson(
  value: JsonValue,
  where: string,
  userContent: FieldPaths,
  context: ScrubContext,
): JsonValue {
  return new JsonWalk(where, userContent, context).visit(value, []);
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

  visit(value: JsonValue, path: ValuePath): JsonValue {
    const declared = this.userContent.match(path);
    if (declared !== undefined) {
      this.context.matchedUserContent.add(declared);
      this.context.report.add("user-content", this.locate(path));
      return asUserContent(value);
    }
    if (typeof value === "string") {
      return this.visitString(value, path);
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => this.visit(item, [...path, index]));
    }
    if (value !== null && typeof value === "object") {
      return this.visitObject(value, path);
    }
    return value;
  }

  private visitObject(value: { [key: string]: JsonValue }, path: ValuePath): JsonValue {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      const scrubbedKey = scrubText(key, this.locate(childPath), this.context);
      result[scrubbedKey] =
        typeof child === "string" && this.isSecretField(key, child, childPath)
          ? this.replaceSecret(child, childPath)
          : this.visit(child, childPath);
    }
    return result;
  }

  private isSecretField(key: string, child: string, childPath: ValuePath): boolean {
    return (
      !PLACEHOLDER.test(child) &&
      this.userContent.match(childPath) === undefined &&
      isSecretName(key, "json", this.context.policy.secretFields)
    );
  }

  private replaceSecret(value: string, path: ValuePath): string {
    this.context.report.add("secret-field", this.locate(path));
    return this.context.fakes.secret(value);
  }

  /**
   * A string that is itself JSON (some APIs nest it) is scrubbed as JSON, so
   * the field-name rules still apply inside it.
   */
  private visitString(value: string, path: ValuePath): string {
    const nested = parseNestedJson(value);
    if (nested === undefined) {
      return scrubText(value, this.locate(path), this.context);
    }
    const scrubbed = this.visit(nested, path);
    const unchanged = JSON.stringify(scrubbed) === JSON.stringify(nested);
    return unchanged ? value : JSON.stringify(scrubbed);
  }

  private locate(path: ValuePath): string {
    const formatted = formatPath(path);
    if (formatted === "") {
      return this.where;
    }
    return formatted.startsWith("[") ? `${this.where}${formatted}` : `${this.where}.${formatted}`;
  }
}

/** The same shape with every leaf replaced: text, zero, false, null. */
function asUserContent(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    return USER_CONTENT_TEXT;
  }
  if (typeof value === "number") {
    return 0;
  }
  if (typeof value === "boolean") {
    return false;
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

function parseNestedJson(value: string): JsonValue | undefined {
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
