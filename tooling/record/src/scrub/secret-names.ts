/**
 * Field names that say "this value is a secret". Names are compared without
 * case, `-` or `_`, so `refresh_token`, `refreshToken` and `Refresh-Token`
 * are the same name.
 */

/** A name containing one of these is a secret, such as `refresh_token` or `client_secret`. */
const SECRET_NAME_PARTS = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "privatekey",
  "accesskey",
  "credential",
  "sessionid",
];

/** Names that are a secret only when they are the whole name. */
const SECRET_NAMES = ["key", "sig", "signature", "auth", "authorization"];

/**
 * Only in URLs and form data: the OAuth authorization code. In JSON, `code`
 * is nearly always an error code that tests need to see.
 */
const SECRET_NAMES_IN_URLS_AND_FORMS = ["code"];

/** Names that contain a secret-like part but describe one instead of holding it. */
const NOT_SECRET_NAMES = ["tokentype"];

export type FieldKind = "json" | "query-or-form";

/** True when a field with this name holds a secret, given what the integration declared. */
export function isSecretName(name: string, kind: FieldKind, declared: readonly string[]): boolean {
  const normalized = normalize(name);
  if (declared.some((declaredName) => normalize(declaredName) === normalized)) {
    return true;
  }
  if (NOT_SECRET_NAMES.includes(normalized)) {
    return false;
  }
  if (SECRET_NAMES.includes(normalized)) {
    return true;
  }
  if (kind === "query-or-form" && SECRET_NAMES_IN_URLS_AND_FORMS.includes(normalized)) {
    return true;
  }
  return SECRET_NAME_PARTS.some((part) => normalized.includes(part));
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_\s]/g, "");
}
