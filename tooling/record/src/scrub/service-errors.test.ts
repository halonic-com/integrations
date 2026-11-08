import { describe, expect, it } from "vitest";
import type { CapturedExchange, RecordedBody } from "./exchange.ts";
import { definePolicy } from "./policy.ts";
import { scrubExchanges } from "./scrubber.ts";
import { serviceErrorPaths } from "./service-errors.ts";

const JSON_HEADERS: [string, string][] = [["content-type", "application/json"]];

/** A Google error that repeats an invented file name the request sent. */
const googleErrorBody = {
  error: {
    code: 400,
    message: "Invalid value for name: Holiday plans.txt",
    status: "INVALID_ARGUMENT",
    errors: [
      { domain: "global", reason: "invalid", message: "Invalid value for name: Holiday plans.txt" },
    ],
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.BadRequest",
        fieldViolations: [{ field: "name", description: "Holiday plans.txt is too long" }],
      },
    ],
  },
};

function exchangeWith(url: string, status: number, body: unknown): CapturedExchange {
  return {
    request: { method: "GET", url, headers: [] },
    response: { status, headers: JSON_HEADERS, body: JSON.stringify(body) },
  };
}

function scrubbedBody(exchange: CapturedExchange, userContent: string[] = []): unknown {
  const { exchanges } = scrubExchanges([exchange], { policy: definePolicy({ userContent }) });
  const body = exchanges[0]?.response.body;
  return body?.kind === "json" ? body.value : undefined;
}

const googleErrorJson: RecordedBody = { kind: "json", value: googleErrorBody };

describe("serviceErrorPaths", () => {
  it("adds Google's error paths for every googleapis.com host", () => {
    for (const url of [
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      "https://www.googleapis.com/drive/v3/files",
      "https://GoogleAPIs.com/x",
    ]) {
      expect(serviceErrorPaths(url, googleErrorJson)).toEqual(
        expect.arrayContaining([
          "response.body.error.message",
          "response.body.error.errors[*].message",
          "response.body.error.details[*].fieldViolations",
          "response.body.error.details[*].metadata",
        ]),
      );
    }
  });

  it("leaves out the detail fields integrations map errors by", () => {
    const paths = serviceErrorPaths("https://www.googleapis.com/x", googleErrorJson);
    for (const kept of ["@type", "reason", "domain", "retryDelay"]) {
      expect(paths).not.toContain(`response.body.error.details[*].${kept}`);
    }
    expect(paths).not.toContain("response.body.error.details");
  });

  it("adds nothing for other hosts, including look-alikes", () => {
    for (const url of [
      "https://mail.example.com/v1/messages",
      "https://evilgoogleapis.com/x",
      "https://googleapis.com.example.com/x",
      "not a url",
    ]) {
      expect(serviceErrorPaths(url, googleErrorJson)).toEqual([]);
    }
  });

  it("adds nothing for a body that isn't in Google's error format", () => {
    const url = "https://oauth2.googleapis.com/token";
    const bodies: RecordedBody[] = [
      { kind: "json", value: { error: "invalid_grant", error_description: "Bad Request" } },
      { kind: "json", value: { error: null } },
      { kind: "json", value: { error: [] } },
      { kind: "json", value: ["error"] },
      { kind: "empty" },
    ];
    for (const body of bodies) {
      expect(serviceErrorPaths(url, body)).toEqual([]);
    }
  });
});

describe("Google error text in a recording", () => {
  it("replaces the text and keeps what integrations map errors by", () => {
    const exchange = exchangeWith(
      "https://www.googleapis.com/drive/v3/files",
      400,
      googleErrorBody,
    );
    expect(scrubbedBody(exchange)).toEqual({
      error: {
        code: 400,
        message: "<scrubbed:content>",
        status: "INVALID_ARGUMENT",
        errors: [{ domain: "global", reason: "invalid", message: "<scrubbed:content>" }],
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.BadRequest",
            fieldViolations: [{ "field-1": "<scrubbed:content>", "field-2": "<scrubbed:content>" }],
          },
        ],
      },
    });
  });

  it("keeps the reason a refused key is given in, and replaces its metadata", () => {
    // The shape of Gemini's answer to a wrong key: https://aistudio.google.com/docs/api-errors
    const keyRefused = {
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "API_KEY_INVALID",
            domain: "googleapis.com",
            metadata: { service: "generativelanguage.googleapis.com" },
          },
        ],
      },
    };
    const exchange = exchangeWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      400,
      keyRefused,
    );
    expect(scrubbedBody(exchange)).toEqual({
      error: {
        code: 400,
        message: "<scrubbed:content>",
        status: "INVALID_ARGUMENT",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "API_KEY_INVALID",
            domain: "googleapis.com",
            metadata: { "field-1": "<scrubbed:content>" },
          },
        ],
      },
    });
  });

  it("replaces details whole when they aren't a list", () => {
    const exchange = exchangeWith("https://www.googleapis.com/drive/v3/files", 400, {
      error: { code: 400, status: "INVALID_ARGUMENT", details: { note: "Holiday plans.txt" } },
    });
    expect(scrubbedBody(exchange)).toEqual({
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        details: { "field-1": "<scrubbed:content>" },
      },
    });
  });

  it("leaves the same body from another service to the free-text rules", () => {
    const exchange = exchangeWith("https://api.example.com/files", 400, googleErrorBody);
    expect(scrubbedBody(exchange)).toEqual(googleErrorBody);
  });

  it("keeps the code of an OAuth error, which isn't in Google's error format", () => {
    const oauthError = { error: "invalid_grant", error_description: "Bad Request" };
    const exchange = exchangeWith("https://oauth2.googleapis.com/token", 400, oauthError);
    expect(scrubbedBody(exchange)).toEqual(oauthError);
  });

  it("never stops a recording without an error", () => {
    const exchange = exchangeWith("https://gmail.googleapis.com/gmail/v1/users/me/labels", 200, {
      labels: [{ id: "INBOX" }],
    });
    const { report } = scrubExchanges([exchange], { policy: definePolicy() });
    expect(report.unmatchedUserContent).toEqual([]);
  });

  it("counts a path the sheet declares itself as used", () => {
    const exchange = exchangeWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/m1",
      404,
      { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } },
    );
    const { report } = scrubExchanges([exchange], {
      policy: definePolicy({ userContent: ["response.body.error.message"] }),
    });
    expect(report.unmatchedUserContent).toEqual([]);
  });
});
