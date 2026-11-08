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
