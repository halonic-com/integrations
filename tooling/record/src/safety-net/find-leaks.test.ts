import { describe, expect, it } from "vitest";
import { encodeBase64 } from "../scrub/base64.ts";
import { FAKE } from "../test/fakes.ts";
import { findLeaks } from "./find-leaks.ts";

function kinds(text: string, knownSecrets: readonly string[] = []): string[] {
  return findLeaks(text, knownSecrets).map((leak) => leak.kind);
}

describe("findLeaks", () => {
  it("finds a known key value", () => {
    expect(kinds(`{"x":"${FAKE.plainKey}"}`, [FAKE.plainKey])).toEqual(["known-secret"]);
  });

  it("finds a known key as it looks inside a JSON string", () => {
    const keyWithQuote = 'fake"key\\with-escapes-0123456789';
    expect(kinds(JSON.stringify({ x: keyWithQuote }), [keyWithQuote])).toContain("known-secret");
  });

  it("finds a piece of a known key", () => {
    expect(kinds(`{"x":"${FAKE.plainKey.slice(3, 18)}"}`, [FAKE.plainKey])).toEqual([
      "known-secret",
    ]);
  });

  it("finds our fake-key marker anywhere", () => {
    expect(kinds(`{"note":"${FAKE.apiKey}"}`)).toEqual(["fake-key"]);
  });

  it.each([
    ["a JWT", FAKE.jwt],
    ["an sk- key", FAKE.openAiKey],
    ["a Google API key", FAKE.googleKey],
  ])("finds %s", (_label, token) => {
    expect(kinds(`{"x":"${token}"}`)).toEqual(["token-shape"]);
  });

  it("finds e-mail addresses and phone numbers", () => {
    expect(kinds(`{"a":"${FAKE.email}","b":"${FAKE.phone}"}`)).toEqual(["email", "phone"]);
  });

  it("looks inside base64 text", () => {
    const encoded = encodeBase64(`To: ${FAKE.email}`, { urlSafe: true, padded: false });
    expect(findLeaks(`{"raw":"${encoded}"}`, [])).toEqual([{ kind: "email", offset: 8 }]);
  });

  it("looks inside URL-encoded text, such as a search in a query string", () => {
    const url = `https://mail.example.com/v1/messages?q=${encodeURIComponent(`from:${FAKE.email}`)}`;
    expect(findLeaks(`{"url":"${url}"}`, [])).toEqual([{ kind: "email", offset: 8 }]);
  });

  it("looks inside a URL encoded twice, as in a URL inside a query value", () => {
    const next = `https://mail.example.com/?q=${encodeURIComponent(FAKE.email)}`;
    const url = `https://login.example.com/?next=${encodeURIComponent(next)}`;
    expect(kinds(`{"url":"${url}"}`)).toEqual(["email"]);
  });

  it("counts an address once when it is both plain and encoded in one run", () => {
    const value = `${FAKE.email}%20${encodeURIComponent(FAKE.otherEmail)}`;
    expect(kinds(`{"x":"${value}"}`)).toEqual(["email"]);
  });

  it("scans a large base64 body quickly", () => {
    // A body of 200,000 base64 characters with no `%` or `@` in it took about
    // 26 seconds before the encoded-text and address patterns were anchored
    // to the start of a run.
    const body = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo".repeat(6_000).slice(0, 200_000);
    const encodedAddress = encodeURIComponent(FAKE.email);
    const started = performance.now();
    const found = kinds(`{"raw":"${body}","q":"${encodedAddress}"}`);
    const elapsed = performance.now() - started;
    expect(found).toEqual(["email"]);
    expect(elapsed).toBeLessThan(1_000);
  });

  it("accepts the scrubber's own stand-ins", () => {
    const scrubbed = JSON.stringify({
      authorization: "Bearer <scrubbed:secret>",
      cookie: "<scrubbed:secret>",
      nextPageToken: "scrubbed-secret-1",
      url: "https://api.example.com/?key=%3Cscrubbed%3Asecret%3E",
      search: "https://api.example.com/?q=from%3Aperson1%40example.com&n=%2B447700900001",
      replyTo: "support@mail.example.com",
      from: "person1@example.com",
      phone: "+447700900001",
      text: "<scrubbed:content>",
    });
    expect(findLeaks(scrubbed, [FAKE.plainKey])).toEqual([]);
  });

  it("finds a value under a secret name that isn't a stand-in, after the text leaks", () => {
    const headers = { "x-access-token": "hunter2hunter2", "x-user": FAKE.email };
    const text = JSON.stringify({ exchanges: [{ request: { headers } }] });
    expect(findLeaks(text, [])).toEqual([
      { kind: "email", offset: text.indexOf(FAKE.email) },
      { kind: "secret-field", path: "exchanges[0].request.headers.x-access-token" },
    ]);
  });

  it("names the kind and place, never the value", () => {
    const leaks = findLeaks(`{"x":"${FAKE.plainKey}"}`, [FAKE.plainKey]);
    expect(JSON.stringify(leaks)).not.toContain(FAKE.plainKey);
  });
});
