import { isSecretHeader } from "../scrub/headers.ts";
import { AUTH_SCHEME, PLACEHOLDER } from "../scrub/patterns.ts";
import { type FieldKind, isSecretName, jsonFieldKind } from "../scrub/secret-names.ts";
import { RELATIVE_BASE } from "../scrub/url.ts";

/** Headers whose value is a URL, as the scrubber reads them. */
const URL_HEADERS = ["location", "content-location", "referer"];

/**
 * The second half of the safety net: reads the finished file and checks that
 * every value under a secret name is a stand-in. The text scan can't do
 * this: a short password in `X-Access-Token` or in a `password` field has
 * no shape to find.
 *
 * It checks header names, query parameters (also in URL headers and in a URL
 * inside a query value), form fields and JSON fields, including stream event
 * data. Names are judged by the scrubber's own functions, without the
 * integration's declarations, which only ever add names.
 *
 * @returns the places that hold something other than a stand-in, never the values
 */
export function findSecretFields(text: string): string[] {
  const found: string[] = [];
  const exchanges = field(parse(text), "exchanges");
  if (!Array.isArray(exchanges)) {
    return found;
  }
  exchanges.forEach((exchange: unknown, index) => {
    for (const side of ["request", "response"]) {
      const message = field(exchange, side);
      const where = `exchanges[${index}].${side}`;
      checkHeaders(field(message, "headers"), `${where}.headers`, found);
      checkUrl(field(message, "url"), `${where}.url`, found);
      checkBody(field(message, "body"), `${where}.body`, found);
    }
  });
  return found;
}

function checkHeaders(headers: unknown, where: string, found: string[]): void {
  for (const [name, value] of entries(headers)) {
    if (isSecretHeader(name)) {
      check(value, `${where}.${name}`, found);
    } else if (URL_HEADERS.includes(name)) {
      checkUrl(value, `${where}.${name}`, found);
    }
  }
}

function checkUrl(url: unknown, where: string, found: string[]): void {
  if (typeof url !== "string" || !URL.canParse(url, RELATIVE_BASE)) {
    return;
  }
  for (const [name, value] of new URL(url, RELATIVE_BASE).searchParams) {
    const location = `${where}.query.${name}`;
    if (isSecretField(name, "query-or-form")) {
      check(value, location, found);
    } else if (/^https?:\/\//i.test(value)) {
      checkUrl(value, location, found);
    }
  }
}

function checkBody(body: unknown, where: string, found: string[]): void {
  const kind = field(body, "kind");
  const value = field(body, "value");
  if (kind === "json") {
    checkJson(value, where, false, found);
  } else if (kind === "form" && Array.isArray(value)) {
    for (const pair of value) {
      const [name, fieldValue]: unknown[] = Array.isArray(pair) ? pair : [];
      if (typeof name === "string" && isSecretField(name, "query-or-form")) {
        check(fieldValue, `${where}.${name}`, found);
      }
    }
  } else if (kind === "sse" && Array.isArray(value)) {
    value.forEach((event: unknown, index) => {
      checkJson(field(event, "data"), `${where}[${index}].data`, false, found);
    });
  }
}

/** Below a secret name, every string, however deep, must be a stand-in. */
function checkJson(value: unknown, where: string, secret: boolean, found: string[]): void {
  if (typeof value === "string") {
    if (secret) {
      check(value, where, found);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => {
      checkJson(item, `${where}[${index}]`, secret, found);
    });
  } else if (value !== null && typeof value === "object") {
    const kind = jsonFieldKind(value);
    for (const [key, child] of entries(value)) {
      const childSecret = secret || isSecretField(key, kind);
      checkJson(child, `${where}.${key}`, childSecret, found);
    }
  }
}

/**
 * A name the scrubber replaced is not a secret name: a random-looking key
 * (a map keyed by a 32-hex ID) becomes `scrubbed-secret-1`, which would
 * otherwise read as a secret name because it contains "secret".
 */
function isSecretField(name: string, kind: FieldKind): boolean {
  return !PLACEHOLDER.test(name) && isSecretName(name, kind, []);
}

/** Empty, or a stand-in after an optional auth scheme (`Bearer <scrubbed:secret>`). */
function check(value: unknown, where: string, found: string[]): void {
  if (typeof value !== "string") {
    return;
  }
  const credential = value.replace(AUTH_SCHEME, "");
  if (credential !== "" && !PLACEHOLDER.test(credential)) {
    found.push(where);
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not a recording file: the text scan still covers it.
    return undefined;
  }
}

function field(value: unknown, name: string): unknown {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

function entries(value: unknown): [string, unknown][] {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}
