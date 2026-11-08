import { maxEnumValues } from "./limits.ts";

/**
 * The names Halonic accepts for a listed tool: 1 to 64 letters, digits,
 * `_` or `-` (`ports.untrusted-tool-listings` in the `halonic` repo, guide
 * section 6). Narrower than the MCP specification, which also allows `.`
 * and up to 128 characters. Calls send the name back unfenced, and model
 * providers accept no other names for tools.
 *
 * The same rule holds for every other string a call can send back, so
 * Halonic can't fence it: property names, `required` strings, `$defs`
 * names and the strings in `enum` and `const`.
 */
export const listedToolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

/** An argument schema whose names Halonic accepts. */
export interface ListedSchema {
  /** The server's schema, without the `enum` and `const` values Halonic would drop. */
  readonly schema: Record<string, unknown>;
  /**
   * The strings the schema still holds that reach the model unfenced, each
   * time it appears: property names, `required` strings, `$defs` names and
   * the strings in `enum` and `const`.
   */
  readonly unfencedStrings: readonly string[];
}

/**
 * Applies Halonic's name rule ({@link listedToolNamePattern}) to an
 * argument schema, at any depth:
 *
 * - a property name, `required` string or `$defs` name that breaks it
 *   makes Halonic refuse the tool, so we return `undefined`;
 * - an `enum` or `const` that holds anything other than `null`, booleans,
 *   numbers and strings that pass it is dropped, and so is an `enum` with
 *   more than {@link maxEnumValues} values.
 *
 * Walks the schema by its keywords, so a property named `enum` is a name,
 * not a keyword. Recursive: check the schema's depth first.
 */
export function withListedNames(schema: Record<string, unknown>): ListedSchema | undefined {
  const unfencedStrings: string[] = [];
  try {
    const checked = checkSchema(schema, unfencedStrings) as Record<string, unknown>;
    return { schema: checked, unfencedStrings };
  } catch (error) {
    if (error instanceof NameRuleBroken) {
      return undefined;
    }
    throw error;
  }
}

/** Thrown inside the walk when Halonic would refuse the tool. */
class NameRuleBroken extends Error {}

/** Keywords whose keys are names a call sends back, and whose values are schemas. */
const namedSchemaKeywords = new Set(["properties", "$defs", "definitions"]);

/** Keywords whose value is a schema or a list of schemas. */
const subschemaKeywords = new Set([
  "items",
  "prefixItems",
  "additionalItems",
  "additionalProperties",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "anyOf",
  "oneOf",
  "allOf",
]);

/** Keywords whose values are schemas, under keys that are patterns or property names. */
const schemaMapKeywords = new Set(["patternProperties", "dependentSchemas"]);

/**
 * A copy of one schema with its names checked. Anything that isn't a
 * schema object, such as `true`, stays as it is.
 *
 * @throws {NameRuleBroken} for a name Halonic refuses
 */
function checkSchema(schema: unknown, unfencedStrings: string[]): unknown {
  if (!isPlainObject(schema)) {
    return schema;
  }
  const entries: [string, unknown][] = [];
  for (const [keyword, value] of Object.entries(schema)) {
    if (namedSchemaKeywords.has(keyword) && isPlainObject(value)) {
      entries.push([keyword, checkNamedSchemas(value, unfencedStrings)]);
    } else if (keyword === "required" && Array.isArray(value)) {
      for (const name of value.filter((item) => typeof item === "string")) {
        requireListedName(name, unfencedStrings);
      }
      entries.push([keyword, value]);
    } else if (keyword === "enum" || keyword === "const") {
      const values = keyword === "enum" ? value : [value];
      if (isListedValueList(values)) {
        unfencedStrings.push(...values.filter((item) => typeof item === "string"));
        entries.push([keyword, value]);
      }
    } else if (subschemaKeywords.has(keyword)) {
      const checked = Array.isArray(value)
        ? value.map((item) => checkSchema(item, unfencedStrings))
        : checkSchema(value, unfencedStrings);
      entries.push([keyword, checked]);
    } else if (schemaMapKeywords.has(keyword) && isPlainObject(value)) {
      const checked = Object.entries(value).map(([key, item]) => [
        key,
        checkSchema(item, unfencedStrings),
      ]);
      entries.push([keyword, Object.fromEntries(checked)]);
    } else {
      entries.push([keyword, value]);
    }
  }
  // Built with `fromEntries`, which always makes own keys: assigning a
  // `__proto__` key would set the copy's prototype and lose the key.
  return Object.fromEntries(entries);
}

/** `properties` or `$defs`: each key is a name, each value a schema. */
function checkNamedSchemas(
  schemas: Record<string, unknown>,
  unfencedStrings: string[],
): Record<string, unknown> {
  const checked = Object.entries(schemas).map(([name, schema]) => {
    requireListedName(name, unfencedStrings);
    return [name, checkSchema(schema, unfencedStrings)];
  });
  return Object.fromEntries(checked);
}

/** @throws {NameRuleBroken} when `name` breaks the rule */
function requireListedName(name: string, unfencedStrings: string[]): void {
  if (!listedToolNamePattern.test(name)) {
    throw new NameRuleBroken();
  }
  unfencedStrings.push(name);
}

/**
 * Whether Halonic keeps an `enum` or `const` with these values: at most
 * {@link maxEnumValues}, each `null`, a boolean, a number or a string that
 * passes the rule.
 */
function isListedValueList(values: unknown): values is unknown[] {
  if (!Array.isArray(values) || values.length > maxEnumValues) {
    return false;
  }
  return values.every(
    (value) =>
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      (typeof value === "string" && listedToolNamePattern.test(value)),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
