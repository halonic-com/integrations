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

  it("names its cause for Halonic's run record, with the API and project Google named", () => {
    const error = new GoogleApiDisabledError("Switched off.", {
      api: "drive.googleapis.com",
      project: "123456789012",
    });
    expect(error.failureCause).toEqual({
      code: "google.api-disabled",
      detail: {
        api: "drive.googleapis.com",
        project: "123456789012",
        enableUrl:
          "https://console.cloud.google.com/apis/library/drive.googleapis.com?project=123456789012",
      },
    });
  });

  it("links to the API's page without a project when Google named none", () => {
    const error = new GoogleApiDisabledError("Switched off.", {
      api: "gmail.googleapis.com",
      project: undefined,
    });
    expect(error.failureCause.detail).toStrictEqual({
      api: "gmail.googleapis.com",
      enableUrl: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
    });
  });

  it("gives no link for a project alone, as there is no API page to open", () => {
    const error = new GoogleApiDisabledError("Switched off.", {
      api: undefined,
      project: "123456789012",
    });
    expect(error.failureCause.detail).toStrictEqual({ project: "123456789012" });
  });

  it("leaves out what Google didn't name", () => {
    const error = new GoogleApiDisabledError("Switched off.", {
      api: undefined,
      project: undefined,
    });
    expect(error.failureCause).toStrictEqual({ code: "google.api-disabled", detail: {} });
  });
});
