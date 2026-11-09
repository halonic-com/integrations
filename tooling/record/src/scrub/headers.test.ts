import { describe, expect, it } from "vitest";
import { FAKE, rulesUsed, testContext } from "../test/fakes.ts";
import { scrubHeaders } from "./headers.ts";

describe("scrubHeaders", () => {
  it.each([
    ["authorization", `Bearer ${FAKE.plainKey}`, "Bearer <scrubbed:secret>"],
    ["proxy-authorization", `Basic ${FAKE.plainKey}`, "Basic <scrubbed:secret>"],
    ["x-api-key", FAKE.plainKey, "<scrubbed:secret>"],
    ["cookie", `sid=${FAKE.plainKey}; theme=dark`, "<scrubbed:secret>"],
    ["set-cookie", `sid=${FAKE.plainKey}; HttpOnly`, "<scrubbed:secret>"],
  ])("replaces %s", (name, value, expected) => {
    const context = testContext();
    expect(scrubHeaders([[name, value]], "headers", context)).toEqual({ [name]: expected });
    expect(rulesUsed(context)).toEqual(["secret-header"]);
  });

  it.each([
    ["X-Access-Token", "hunter2hunter2"],
    ["Private-Token", "fakepassword1"],
    ["X-Session-Token", "fake-session"],
    ["X-Csrf-Token", "fake-csrf"],
    ["X-Subject-Token", "fake0subject0token00"],
    ["X-Session-Id", "fake-session-id"],
  ])("replaces a short value in %s, a header named like a secret", (name, value) => {
    const context = testContext();
    expect(scrubHeaders([[name, value]], "headers", context)).toEqual({
      [name.toLowerCase()]: "scrubbed-secret-1",
    });
    expect(rulesUsed(context)).toEqual(["secret-header"]);
  });

  it("gives the fixed stand-in to the integration's key in a header named like a secret", () => {
    const context = testContext({}, [FAKE.plainKey]);
    expect(scrubHeaders([["x-access-token", FAKE.plainKey]], "headers", context)).toEqual({
      "x-access-token": "<scrubbed:secret>",
    });
  });

  it("keeps the auth scheme in any case", () => {
    const scrubbed = scrubHeaders(
      [
        ["authorization", `bearer ${FAKE.plainKey}`],
        ["x-upstream-token", "token fake-upstream"],
      ],
      "headers",
      testContext(),
    );
    expect(scrubbed).toEqual({
      authorization: "bearer <scrubbed:secret>",
      "x-upstream-token": "token scrubbed-secret-1",
    });
  });

  it("leaves out rate-limit headers about tokens instead of keeping them as secrets", () => {
    const scrubbed = scrubHeaders(
      [
        ["x-ratelimit-remaining-tokens", "39000"],
        ["anthropic-ratelimit-tokens-remaining", "39000"],
      ],
      "headers",
      testContext(),
    );
    expect(scrubbed).toEqual({});
  });

  it("keeps the CORS credentials flag", () => {
    const headers = [["access-control-allow-credentials", "true"]] as const;
    expect(scrubHeaders(headers, "headers", testContext())).toEqual({
      "access-control-allow-credentials": "true",
    });
  });

  it("finds a secret header with odd casing and writes the name in lower case", () => {
    expect(scrubHeaders([["X-Api-KEY", FAKE.plainKey]], "headers", testContext())).toEqual({
      "x-api-key": "<scrubbed:secret>",
    });
  });

  it("replaces headers the integration declares as secret", () => {
    const context = testContext({ secretHeaders: ["X-Goog-Api-Key"] });
    expect(scrubHeaders([["x-goog-api-key", FAKE.plainKey]], "headers", context)).toEqual({
      "x-goog-api-key": "<scrubbed:secret>",
    });
  });

  it("joins repeated headers, as fetch does", () => {
    const scrubbed = scrubHeaders(
      [
        ["Link", "<https://api.example.com/p/2>; rel=next"],
        ["link", "<https://api.example.com/p/9>; rel=last"],
      ],
      "headers",
      testContext(),
    );
    expect(scrubbed).toEqual({
      link: "<https://api.example.com/p/2>; rel=next, <https://api.example.com/p/9>; rel=last",
    });
  });

  it("leaves out headers that change on every run", () => {
    const scrubbed = scrubHeaders(
      [
        ["Date", "Sun, 08 Nov 2026 09:00:00 GMT"],
        ["x-request-id", "req-1"],
        ["content-length", "42"],
        ["x-ratelimit-remaining", "99"],
        ["content-type", "application/json"],
      ],
      "headers",
      testContext(),
    );
    expect(scrubbed).toEqual({ "content-type": "application/json" });
  });

  it("leaves out headers that name the account behind the key", () => {
    const scrubbed = scrubHeaders(
      [
        ["anthropic-organization-id", "00000000-0000-4000-8000-000000000001"],
        ["Anthropic-Workspace-Id", "wrkspc_fake"],
        ["openai-organization", "example-org"],
        ["openai-project", "proj_fake"],
        ["traceresponse", "00-fake-01"],
        ["content-type", "application/json"],
      ],
      "headers",
      testContext(),
    );
    expect(scrubbed).toEqual({ "content-type": "application/json" });
  });

  it("leaves out content-encoding, because the file holds the decoded body", () => {
    const scrubbed = scrubHeaders(
      [
        ["Content-Encoding", "gzip"],
        ["content-type", "application/json"],
      ],
      "headers",
      testContext(),
    );
    expect(scrubbed).toEqual({ "content-type": "application/json" });
  });

  it("keeps a declared secret header even when its name looks unstable", () => {
    const context = testContext({ secretHeaders: ["x-request-id"] });
    expect(scrubHeaders([["x-request-id", FAKE.plainKey]], "headers", context)).toEqual({
      "x-request-id": "<scrubbed:secret>",
    });
  });

  it("scrubs the URL in a location header", () => {
    const location = `https://api.example.com/next?access_token=${FAKE.plainKey}`;
    expect(scrubHeaders([["Location", location]], "headers", testContext())).toEqual({
      location: "https://api.example.com/next?access_token=scrubbed-secret-1",
    });
  });

  it("scrubs every URL in a link header and keeps the rest", () => {
    const link = [
      `<https://api.example.com/items?access_token=${FAKE.plainKey}&page=2>; rel="next"`,
      `</items?page=9>; rel="last"; title="${FAKE.email}"`,
    ].join(", ");
    expect(scrubHeaders([["Link", link]], "headers", testContext())).toEqual({
      link: [
        '<https://api.example.com/items?access_token=scrubbed-secret-1&page=2>; rel="next"',
        '</items?page=9>; rel="last"; title="person1@example.com"',
      ].join(", "),
    });
  });

  it("scrubs a relative URL in a location header and keeps it relative", () => {
    const location = `/callback?code=${FAKE.plainKey}&state=1`;
    expect(scrubHeaders([["Location", location]], "headers", testContext())).toEqual({
      location: "/callback?code=scrubbed-secret-1&state=1",
    });
  });

  it("leaves an ordinary relative location exactly as it was", () => {
    expect(scrubHeaders([["location", "next/page?x=1"]], "headers", testContext())).toEqual({
      location: "next/page?x=1",
    });
  });

  it("applies the text rules to other headers and keeps ordinary ones", () => {
    const scrubbed = scrubHeaders(
      [
        ["x-user-email", FAKE.email],
        ["content-type", "application/json"],
      ],
      "headers",
      testContext(),
    );
    expect(scrubbed).toEqual({
      "x-user-email": "person1@example.com",
      "content-type": "application/json",
    });
  });
});
