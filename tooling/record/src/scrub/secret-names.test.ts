import { describe, expect, it } from "vitest";
import { isSecretName } from "./secret-names.ts";

describe("isSecretName", () => {
  it.each(["access_token", "refreshToken", "Client-Secret", "passphrase", "pass", "X-Session-Id"])(
    "says %s is a secret",
    (name) => {
      expect(isSecretName(name, "json", [])).toBe(true);
    },
  );

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

  it("adds the names the integration declares, in any spelling", () => {
    expect(isSecretName("uploadHandle", "json", ["upload_handle"])).toBe(true);
  });
});
