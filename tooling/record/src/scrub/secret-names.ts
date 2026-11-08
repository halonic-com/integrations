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
  "passphrase",
  "apikey",
  "privatekey",
  "accesskey",
  "credential",
  "sessionid",
];

/**
 * Names that are a secret only when they are the whole name. `code_verifier`
 * is the PKCE secret of an OAuth token request.
 */
const SECRET_NAMES = ["key", "sig", "signature", "auth", "authorization", "pass", "codeverifier"];

/**
 * Only in URLs, form data and the JSON body of an OAuth token request: the
 * OAuth authorization code. In other JSON, `code` is nearly always an error
 * code that tests need to see.
 */
const AUTHORIZATION_CODE_NAMES = ["code"];

/**
 * Names that contain a secret-like part but describe one instead of holding
 * it. `Access-Control-Allow-Credentials` is a CORS header that holds `true`.
 */
const NOT_SECRET_NAMES = ["tokentype", "accesscontrolallowcredentials"];

/**
 * Where the name was found. `oauth-token-json` is a JSON object that sends an
 * OAuth grant (see `jsonFieldKind`). Header names follow the JSON rules:
 * `code` is never a secret there.
 */
export type FieldKind = "json" | "oauth-token-json" | "query-or-form" | "header";

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
  const codeIsSecret = kind === "query-or-form" || kind === "oauth-token-json";
  if (codeIsSecret && AUTHORIZATION_CODE_NAMES.includes(normalized)) {
    return true;
  }
  return SECRET_NAME_PARTS.some((part) => normalized.includes(part));
}

/**
 * The kind of the fields in a JSON object. An OAuth token request names its
 * `grant_type`; most are form data, but some clients send JSON, and then
 * `code` is the authorization code as in a form.
 */
export function jsonFieldKind(fields: object): "json" | "oauth-token-json" {
  const names = Object.keys(fields).map(normalize);
  return names.includes("granttype") ? "oauth-token-json" : "json";
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_\s]/g, "");
}
