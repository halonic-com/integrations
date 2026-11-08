import { describe, expect, it } from "vitest";
import { isSecretName, jsonFieldKind } from "./secret-names.ts";

describe("isSecretName", () => {
  it.each([
    "access_token",
    "refreshToken",
    "id_token",
    "code_verifier",
    "Client-Secret",
    "passphrase",
    "pass",
    "X-Session-Id",
  ])("says %s is a secret", (name) => {
    expect(isSecretName(name, "json", [])).toBe(true);
  });

  it.each(["token_type", "passage", "compass", "Access-Control-Allow-Credentials", "keyboard"])(
    "says %s is not a secret",
    (name) => {
      expect(isSecretName(name, "json", [])).toBe(false);
    },
  );

  it("treats code as a secret only in URLs and form data", () => {
    expect(isSecretName("code", "query-or-form", [])).toBe(true);
    expect(isSecretName("code", "json", [])).toBe(false);
    expect(isSecretName("code", "header", [])).toBe(false);
  });

  it("treats code as a secret in the JSON body of an OAuth token request", () => {
    expect(isSecretName("code", "oauth-token-json", [])).toBe(true);
  });

  it.each([
    [{ grant_type: "authorization_code", code: "x" }, "oauth-token-json"],
    [{ grantType: "authorization_code", code: "x" }, "oauth-token-json"],
    [{ error: { code: 404 } }, "json"],
  ])("judges the fields of %j as %s", (fields, kind) => {
    expect(jsonFieldKind(fields)).toBe(kind);
  });

  it("adds the names the integration declares, in any spelling", () => {
    expect(isSecretName("uploadHandle", "json", ["upload_handle"])).toBe(true);
  });
});
