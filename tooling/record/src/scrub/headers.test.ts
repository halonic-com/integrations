import { describe, expect, it } from "vitest";
import { FAKE, rulesUsed, testContext } from "../test/fakes.ts";
import { scrubHeaders } from "./headers.ts";

describe("scrubHeaders", () => {
  it.each([
    ["authorization", `Bearer ${FAKE.plainKey}`, "Bearer scrubbed-secret-1"],
    ["proxy-authorization", `Basic ${FAKE.plainKey}`, "Basic scrubbed-secret-1"],
    ["x-api-key", FAKE.plainKey, "scrubbed-secret-1"],
    ["cookie", `sid=${FAKE.plainKey}; theme=dark`, "scrubbed"],
    ["set-cookie", `sid=${FAKE.plainKey}; HttpOnly`, "scrubbed"],
  ])("replaces %s", (name, value, expected) => {
    const context = testContext();
    expect(scrubHeaders([[name, value]], "headers", context)).toEqual([[name, expected]]);
    expect(rulesUsed(context)).toEqual(["secret-header"]);
  });

  it("finds a secret header with odd casing and writes the name in lower case", () => {
    expect(scrubHeaders([["X-Api-KEY", FAKE.plainKey]], "headers", testContext())).toEqual([
      ["x-api-key", "scrubbed-secret-1"],
    ]);
  });

  it("replaces headers the integration declares as secret", () => {
    const context = testContext({ secretHeaders: ["X-Goog-Api-Key"] });
    expect(scrubHeaders([["x-goog-api-key", FAKE.plainKey]], "headers", context)).toEqual([
      ["x-goog-api-key", "scrubbed-secret-1"],
    ]);
  });

  it("keeps every repeated header", () => {
    const scrubbed = scrubHeaders(
      [
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
      ],
      "headers",
      testContext(),
    );
    expect(scrubbed).toHaveLength(2);
  });

  it("scrubs the URL in a location header", () => {
    const location = `https://api.example.com/next?access_token=${FAKE.plainKey}`;
    expect(scrubHeaders([["Location", location]], "headers", testContext())).toEqual([
      ["location", "https://api.example.com/next?access_token=scrubbed-secret-1"],
    ]);
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
    expect(scrubbed).toEqual([
      ["x-user-email", "person-1@example.com"],
      ["content-type", "application/json"],
    ]);
  });
});
