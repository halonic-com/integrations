import { describe, expect, it } from "vitest";
import { FAKE, rulesUsed, testContext } from "../test/fakes.ts";
import { encodeBase64 } from "./base64.ts";
import { scrubText } from "./text.ts";

describe("scrubText", () => {
  it("replaces known key values", () => {
    const context = testContext({}, [FAKE.plainKey]);
    expect(scrubText(`key is ${FAKE.plainKey}.`, "here", context)).toBe(
      "key is <scrubbed:secret>.",
    );
    expect(rulesUsed(context)).toEqual(["known-secret"]);
  });

  it.each([
    ["a JWT", FAKE.jwt],
    ["an sk- key", FAKE.openAiKey],
    ["a Google API key", FAKE.googleKey],
    ["one of our fake keys", FAKE.apiKey],
  ])("replaces %s by its shape", (_label, token) => {
    const context = testContext();
    expect(scrubText(`value: ${token}`, "here", context)).toBe("value: scrubbed-secret-1");
    expect(rulesUsed(context)).toContain("token-shape");
  });

  it("replaces the token after Bearer, keeping the scheme", () => {
    expect(scrubText("Bearer abc.def-ghi_123", "here", testContext())).toBe(
      "Bearer scrubbed-secret-1",
    );
  });

  it("replaces random-looking values", () => {
    const context = testContext();
    expect(scrubText(`session=${FAKE.randomToken}`, "here", context)).toBe(
      "session=scrubbed-secret-1",
    );
    expect(rulesUsed(context)).toEqual(["random-token"]);
  });

  it("replaces e-mail addresses with stable fakes", () => {
    const context = testContext();
    const text = `${FAKE.email}, ${FAKE.otherEmail}, ${FAKE.email.toUpperCase()}`;
    expect(scrubText(text, "here", context)).toBe(
      "person1@example.com, person2@example.com, person1@example.com",
    );
  });

  it("replaces an e-mail address inside HTML", () => {
    const html = `<p>Write to <a href="mailto:${FAKE.email}">${FAKE.email}</a></p>`;
    expect(scrubText(html, "here", testContext())).toBe(
      '<p>Write to <a href="mailto:person1@example.com">person1@example.com</a></p>',
    );
  });

  it.each([
    ["with a country code", FAKE.phone],
    ["with brackets", "(555) 010-0199"],
    ["split 3-3-4", "555-010-0199"],
  ])("replaces a phone number %s", (_label, number) => {
    const context = testContext();
    expect(scrubText(`call ${number} now`, "here", context)).toBe("call +447700900001 now");
    expect(rulesUsed(context)).toEqual(["phone"]);
  });

  it.each([
    ["a date", "2026-11-08"],
    ["a timestamp", "2026-11-08T09:25:09.158Z"],
    ["a version", "v1.2.3"],
    ["a price", "+12.50"],
    ["a plain ID", "18446744073709551615"],
  ])("keeps %s", (_label, text) => {
    expect(scrubText(text, "here", testContext())).toBe(text);
  });

  it("scrubs inside base64 text and keeps the encoding", () => {
    const inner = `From: ${FAKE.email}\r\n\r\nHello`;
    const encoded = encodeBase64(inner, { urlSafe: true, padded: false });
    const scrubbed = scrubText(encoded, "here", testContext());
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(scrubbed.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
        char.charCodeAt(0),
      ),
    );
    expect(decoded).toBe("From: person1@example.com\r\n\r\nHello");
  });

  it("does not touch its own stand-ins when run again", () => {
    const context = testContext();
    const once = scrubText(
      `Bearer ${FAKE.randomToken} ${FAKE.email} ${FAKE.phone}`,
      "here",
      context,
    );
    expect(scrubText(once, "here", context)).toBe(once);
  });
});
