import { describe, expect, it } from "vitest";
import { GoogleApiDisabledError, GoogleError, type GoogleErrorCode } from "./errors.ts";

describe("GoogleError kind", () => {
  it.each<[GoogleErrorCode, string]>([
    ["bad-arguments", "invalid_input"],
    ["not-signed-in", "unauthenticated"],
    ["not-allowed", "denied"],
    ["not-found", "not_found"],
    ["rate-limited", "limit_reached"],
    ["quota-exceeded", "limit_reached"],
    ["api-disabled", "denied"],
    ["unavailable", "unavailable"],
    ["unexpected-response", "unavailable"],
  ])("maps %s to %s", (code, kind) => {
    const error = new GoogleError(code, "A message.");
    expect(error.kind).toBe(kind);
  });

  it("gives the switched-off API error the kind of its code", () => {
    const error = new GoogleApiDisabledError("Switched off.", {
      api: undefined,
      project: undefined,
    });
    expect(error.kind).toBe("denied");
  });
});
