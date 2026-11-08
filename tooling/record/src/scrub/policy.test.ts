import { describe, expect, it } from "vitest";
import { FAKE } from "../test/fakes.ts";
import { RecordingRefused } from "./context.ts";
import type { CapturedExchange, RecordedExchange } from "./exchange.ts";
import { definePolicy, type ScrubPolicyInput } from "./policy.ts";
import { scrubExchanges } from "./scrubber.ts";

/**
 * One call with a value only the integration knows is secret in each place a
 * policy can name: a header, a query parameter and a JSON field, next to the
 * standard `Authorization` header and `access_token` field.
 */
function tenantCall(): CapturedExchange {
  return {
    request: {
      method: "POST",
      url: `https://api.example.com/v1/notes?fakeCode=${FAKE.plainKey}`,
      headers: [
        ["Authorization", `Bearer ${FAKE.apiKey}`],
        ["X-Fake-Tenant", FAKE.plainKey],
        ["content-type", "application/json"],
      ],
      body: JSON.stringify({ fakeCode: FAKE.plainKey, note: "Fake note text" }),
    },
    response: {
      status: 200,
      headers: [["content-type", "application/json"]],
      body: JSON.stringify({ access_token: FAKE.randomToken, note: "Fake note text" }),
    },
  };
}

function scrubWith(input: ScrubPolicyInput): RecordedExchange {
  const { exchanges } = scrubExchanges([tenantCall()], { policy: definePolicy(input) });
  const [exchange] = exchanges;
  if (exchange === undefined) {
    throw new Error("expected one exchange");
  }
  return exchange;
}

describe("definePolicy", () => {
  it("defaults to declaring nothing and allowing no text bodies", () => {
    expect(definePolicy()).toEqual({
      secretHeaders: [],
      secretFields: [],
      userContent: [],
      allowContentTypes: [],
    });
    expect(definePolicy({})).toEqual(definePolicy());
  });

  it("fills in only the parts an integration leaves out", () => {
    expect(definePolicy({ secretFields: ["fakeCode"] })).toEqual({
      secretHeaders: [],
      secretFields: ["fakeCode"],
      userContent: [],
      allowContentTypes: [],
    });
  });

  it("lower-cases header names and content types", () => {
    const policy = definePolicy({
      secretHeaders: ["X-Fake-Tenant"],
      allowContentTypes: ["Text/Plain"],
    });
    expect(policy.secretHeaders).toEqual(["x-fake-tenant"]);
    expect(policy.allowContentTypes).toEqual(["text/plain"]);
  });

  it("keeps field names and user-content paths as written", () => {
    // Paths match JSON field names exactly, and JSON field names have case.
    const policy = definePolicy({
      secretFields: ["fakeCode"],
      userContent: ["response.body.Items[*].Note"],
    });
    expect(policy.secretFields).toEqual(["fakeCode"]);
    expect(policy.userContent).toEqual(["response.body.Items[*].Note"]);
  });
});

describe("an integration's policy and the standard rules", () => {
  it("applies only the standard rules when the integration declares nothing", () => {
    const exchange = scrubWith({});
    expect(exchange.request.headers["authorization"]).toBe("Bearer <scrubbed:secret>");
    expect(exchange.response.body).toEqual({
      kind: "json",
      value: { access_token: "scrubbed-secret-1", note: "Fake note text" },
    });
    // Without a declaration, a value with no shape can't be told from data.
    expect(exchange.request.headers["x-fake-tenant"]).toBe(FAKE.plainKey);
    expect(exchange.request.url).toContain(FAKE.plainKey);
  });

  it("adds the integration's secret headers to the standard ones, in any casing", () => {
    const exchange = scrubWith({ secretHeaders: ["X-FAKE-TENANT"] });
    expect(exchange.request.headers).toMatchObject({
      authorization: "Bearer <scrubbed:secret>",
      "x-fake-tenant": "<scrubbed:secret>",
    });
  });

  it("adds the integration's secret fields to the standard names, in the URL and the body", () => {
    // `fake_code` and `fakeCode` are the same name to the field rules.
    const exchange = scrubWith({ secretFields: ["fake_code"] });
    expect(exchange.request.url).toBe(
      "https://api.example.com/v1/notes?fakeCode=scrubbed-secret-1",
    );
    expect(exchange.request.body).toEqual({
      kind: "json",
      value: { fakeCode: "scrubbed-secret-1", note: "Fake note text" },
    });
    expect(exchange.response.body).toMatchObject({
      value: { access_token: "scrubbed-secret-2" },
    });
  });

  it("replaces declared user content and nothing else", () => {
    const exchange = scrubWith({ userContent: ["response.body.note"] });
    expect(exchange.response.body).toMatchObject({ value: { note: "<scrubbed:content>" } });
    expect(exchange.request.body).toMatchObject({ value: { note: "Fake note text" } });
  });

  describe("text bodies", () => {
    function textCall(): CapturedExchange {
      return {
        request: { method: "GET", url: "https://api.example.com/v1/readme", headers: [] },
        response: {
          status: 200,
          headers: [["Content-Type", "text/plain; charset=utf-8"]],
          body: `Fake readme. Contact ${FAKE.email}.`,
        },
      };
    }

    it("refuses them by default", () => {
      expect(() => scrubExchanges([textCall()], { policy: definePolicy() })).toThrow(
        RecordingRefused,
      );
    });

    it("allows a declared content type, whatever its casing and parameters", () => {
      const policy = definePolicy({ allowContentTypes: ["Text/Plain"] });
      const { exchanges } = scrubExchanges([textCall()], { policy });
      // Allowed text still goes through the standard rules.
      expect(exchanges[0]?.response.body).toEqual({
        kind: "text",
        contentType: "text/plain",
        value: "Fake readme. Contact person1@example.com.",
      });
    });
  });
});
