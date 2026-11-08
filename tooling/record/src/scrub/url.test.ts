import { describe, expect, it } from "vitest";
import { FAKE, rulesUsed, testContext } from "../test/fakes.ts";
import { RecordingRefused } from "./context.ts";
import { scrubUrl } from "./url.ts";

describe("scrubUrl", () => {
  it.each(["key", "api_key", "access_token", "token", "sig", "code", "refreshToken"])(
    "replaces the query parameter %s",
    (name) => {
      const context = testContext();
      const url = `https://api.example.com/v1/items?${name}=${FAKE.plainKey}&limit=10`;
      expect(scrubUrl(url, "url", context)).toBe(
        `https://api.example.com/v1/items?${name}=scrubbed-secret-1&limit=10`,
      );
      expect(rulesUsed(context)).toEqual(["secret-field"]);
    },
  );

  it("replaces query parameters the integration declares as secret", () => {
    const context = testContext({ secretFields: ["upload_id"] });
    expect(scrubUrl("https://api.example.com/up?upload_id=abc", "url", context)).toBe(
      "https://api.example.com/up?upload_id=scrubbed-secret-1",
    );
  });

  it("replaces a user name and password", () => {
    const context = testContext();
    expect(scrubUrl(`https://user:${FAKE.plainKey}@api.example.com/`, "url", context)).toBe(
      "https://scrubbed:scrubbed@api.example.com/",
    );
    expect(rulesUsed(context)).toEqual(["url-userinfo"]);
  });

  it("replaces an e-mail address in the path", () => {
    expect(
      scrubUrl(`https://api.example.com/users/${FAKE.email}/messages`, "url", testContext()),
    ).toBe("https://api.example.com/users/person-1%40example.com/messages");
  });

  it("replaces an e-mail address in a query value", () => {
    expect(
      scrubUrl(`https://api.example.com/search?q=from:${FAKE.email}`, "url", testContext()),
    ).toBe("https://api.example.com/search?q=from%3Aperson-1%40example.com");
  });

  it("leaves an ordinary URL exactly as it was", () => {
    const url = "https://api.example.com/v1/items?limit=10&fields=id,name";
    expect(scrubUrl(url, "url", testContext())).toBe(url);
  });

  it("refuses a URL it can't parse", () => {
    expect(() => scrubUrl("not a url", "url", testContext())).toThrow(RecordingRefused);
  });
});
