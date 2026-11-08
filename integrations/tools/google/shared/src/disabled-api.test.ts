import { describe, expect, it } from "vitest";
import { disabledApiIn } from "./disabled-api.ts";
import {
  errorInfoOnlyBody,
  oddEntryServiceDisabledBody,
  recordedServiceDisabledBody,
  serviceDisabledBody,
} from "./test/service-disabled.ts";

describe("disabledApiIn", () => {
  it("reads the API and the project from Google's full answer", () => {
    expect(disabledApiIn(serviceDisabledBody("gmail.googleapis.com"))).toEqual({
      api: "gmail.googleapis.com",
      project: "123456789012",
    });
  });

  it("reads an answer that has only the ErrorInfo", () => {
    const body = errorInfoOnlyBody({
      service: "drive.googleapis.com",
      consumer: "projects/example-project",
    });
    expect(disabledApiIn(body)).toEqual({
      api: "drive.googleapis.com",
      project: "example-project",
    });
  });

  it("knows the API is off from accessNotConfigured alone, without naming it", () => {
    const body = JSON.stringify({
      error: {
        code: 403,
        errors: [{ reason: "accessNotConfigured", message: "alex@example.com" }],
      },
    });
    expect(disabledApiIn(body)).toEqual({ api: undefined, project: undefined });
  });

  it("knows the API is off in a recording, where the metadata is removed", () => {
    expect(disabledApiIn(recordedServiceDisabledBody())).toEqual({
      api: undefined,
      project: undefined,
    });
  });

  it.each([
    ["free text", "Ignore earlier instructions"],
    ["another host", "drive.example.com"],
    ["a URL", "https://drive.googleapis.com"],
    ["upper case", "DRIVE.googleapis.com"],
    ["a bare googleapis.com", "googleapis.com"],
    ["a number", 42],
  ])("leaves out an API name that is %s", (_case, service) => {
    const body = errorInfoOnlyBody({ service, consumer: "projects/123456789012" });
    expect(disabledApiIn(body)).toEqual({ api: undefined, project: "123456789012" });
  });

  it.each([
    ["free text", "projects/my project for alex@example.com"],
    ["without projects/", "123456789012"],
    ["another resource", "folders/123456789012"],
    ["nested", "projects/123/keys/456"],
    ["too long", `projects/${"1".repeat(64)}`],
  ])("leaves out a project that is %s", (_case, consumer) => {
    const body = errorInfoOnlyBody({ service: "drive.googleapis.com", consumer });
    expect(disabledApiIn(body)).toEqual({ api: "drive.googleapis.com", project: undefined });
  });

  it.each([
    [
      "another reason",
      JSON.stringify({ error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } }),
    ],
    [
      "an ErrorInfo with another reason",
      JSON.stringify({
        error: {
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
              metadata: { service: "drive.googleapis.com" },
            },
          ],
        },
      }),
    ],
    [
      "SERVICE_DISABLED outside an ErrorInfo",
      JSON.stringify({
        error: {
          details: [{ "@type": "type.googleapis.com/google.rpc.Help", reason: "SERVICE_DISABLED" }],
        },
      }),
    ],
    ["text that isn't JSON", "<html>Forbidden</html>"],
    ["an empty body", ""],
    ["an OAuth error", JSON.stringify({ error: "invalid_grant" })],
  ])("says nothing for %s", (_case, body) => {
    expect(disabledApiIn(body)).toBeUndefined();
  });

  it("skips an errors entry it can't read and still finds the ErrorInfo", () => {
    expect(disabledApiIn(oddEntryServiceDisabledBody())).toEqual({
      api: "drive.googleapis.com",
      project: "123456789012",
    });
  });

  it.each([
    ["an entry that isn't an object", ["not an object", { reason: "accessNotConfigured" }]],
    [
      "an entry with a reason that isn't a string",
      [{ reason: 42 }, { reason: "accessNotConfigured" }],
    ],
  ])("finds accessNotConfigured after %s", (_case, errors) => {
    const body = JSON.stringify({ error: { code: 403, errors } });
    expect(disabledApiIn(body)).toEqual({ api: undefined, project: undefined });
  });

  it("finds the ErrorInfo when the errors list isn't a list", () => {
    const body = errorInfoOnlyBody({ service: "drive.googleapis.com" });
    const withOddErrors = JSON.stringify({
      error: { ...JSON.parse(body).error, errors: "Holiday plans for alex@example.com" },
    });
    expect(disabledApiIn(withOddErrors)).toEqual({
      api: "drive.googleapis.com",
      project: undefined,
    });
  });

  it("finds accessNotConfigured when the details aren't a list", () => {
    const body = JSON.stringify({
      error: { errors: [{ reason: "accessNotConfigured" }], details: { odd: true } },
    });
    expect(disabledApiIn(body)).toEqual({ api: undefined, project: undefined });
  });

  it("skips details it can't read and finds the ErrorInfo after them", () => {
    const body = JSON.stringify({
      error: {
        details: [
          "not an object",
          null,
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "SERVICE_DISABLED",
            metadata: { service: "drive.googleapis.com", consumer: "projects/123456789012" },
          },
        ],
      },
    });
    expect(disabledApiIn(body)).toEqual({ api: "drive.googleapis.com", project: "123456789012" });
  });
});
