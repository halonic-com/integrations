import { describe, expect, it } from "vitest";
import { FAKE, rulesUsed, testContext } from "../test/fakes.ts";
import { encodeBase64 } from "./base64.ts";
import { FieldPaths } from "./field-paths.ts";
import { scrubJson } from "./json.ts";

const noUserContent = new FieldPaths([]);

describe("scrubJson", () => {
  it.each(["access_token", "refresh_token", "client_secret", "password", "idToken", "apiKey"])(
    "replaces a string in a field named %s",
    (name) => {
      const context = testContext();
      expect(scrubJson({ [name]: "abc" }, "body", noUserContent, context)).toEqual({
        [name]: "scrubbed-secret-1",
      });
      expect(rulesUsed(context)).toEqual(["secret-field"]);
    },
  );

  it("keeps numbers in secret-like fields, such as token counts", () => {
    const usage = { max_tokens: 1024, usage: { input_tokens: 12, output_tokens: 34 } };
    expect(scrubJson(usage, "body", noUserContent, testContext())).toEqual(usage);
  });

  it("keeps token_type, which names a scheme", () => {
    expect(scrubJson({ token_type: "Bearer" }, "body", noUserContent, testContext())).toEqual({
      token_type: "Bearer",
    });
  });

  it("keeps error codes", () => {
    const error = { error: { code: "NOT_FOUND", status: 404 } };
    expect(scrubJson(error, "body", noUserContent, testContext())).toEqual(error);
  });

  it("replaces fields the integration declares as secret", () => {
    const context = testContext({ secretFields: ["upload_handle"] });
    expect(scrubJson({ upload_handle: "abc" }, "body", noUserContent, context)).toEqual({
      upload_handle: "scrubbed-secret-1",
    });
  });

  it("replaces token-shaped values in any field", () => {
    expect(scrubJson({ note: `use ${FAKE.jwt}` }, "body", noUserContent, testContext())).toEqual({
      note: "use scrubbed-secret-1",
    });
  });

  it("replaces declared user content with placeholders of the same type", () => {
    const context = testContext();
    const body = {
      messages: [
        { id: "m1", snippet: "Dinner on Friday?", labels: ["INBOX"] },
        { id: "m2", snippet: "Re: Dinner", labels: ["INBOX"] },
      ],
      attachment: { size: 120, inline: true, parts: ["a", "b"], meta: { name: "x.txt" } },
    };
    const paths = new FieldPaths(["messages[].snippet", "attachment"]);
    expect(scrubJson(body, "body", paths, context)).toEqual({
      messages: [
        { id: "m1", snippet: "scrubbed user content", labels: ["INBOX"] },
        { id: "m2", snippet: "scrubbed user content", labels: ["INBOX"] },
      ],
      attachment: {
        "field-1": 0,
        "field-2": false,
        "field-3": ["scrubbed user content", "scrubbed user content"],
        "field-4": { "field-1": "scrubbed user content" },
      },
    });
    expect(context.matchedUserContent).toEqual(new Set(["messages[].snippet", "attachment"]));
  });

  it("doesn't guess user content: undeclared text stays", () => {
    const body = { subject: "Dinner on Friday?" };
    expect(scrubJson(body, "body", noUserContent, testContext())).toEqual(body);
  });

  it("replaces e-mail addresses used as field names", () => {
    expect(
      scrubJson({ [FAKE.email]: { role: "owner" } }, "body", noUserContent, testContext()),
    ).toEqual({ "person-1@example.com": { role: "owner" } });
  });

  it("scrubs JSON nested inside a string", () => {
    const body = { payload: JSON.stringify({ refresh_token: "abc", n: 1 }) };
    expect(scrubJson(body, "body", noUserContent, testContext())).toEqual({
      payload: '{"refresh_token":"scrubbed-secret-1","n":1}',
    });
  });

  // The prefixes put the key at each of the three byte offsets base64 has,
  // so both ways of finding it are covered: the key's own base64 form, and
  // decoding the whole field.
  it.each(['{"a":"', '{"ab":"', '{"abc":"'])(
    "finds a key base64-encoded inside JSON (%s)",
    (prefix) => {
      const context = testContext({}, [FAKE.plainKey]);
      const encoded = encodeBase64(`${prefix}${FAKE.plainKey}"}`, { urlSafe: false, padded: true });
      const scrubbed = scrubJson({ blob: encoded }, "body", noUserContent, context) as {
        blob: string;
      };
      expect(scrubbed.blob).not.toBe(encoded);
      expect(decodeOrSelf(scrubbed.blob)).not.toContain(FAKE.plainKey);
    },
  );

  it("reports where each replacement happened", () => {
    const context = testContext();
    scrubJson({ items: [{ owner: FAKE.email }] }, "response.body", noUserContent, context);
    expect(context.report.build([]).replacements).toEqual([
      { rule: "email", where: "response.body.items[0].owner" },
    ]);
  });
});

/** The decoded text when `value` is base64, otherwise `value` itself. */
function decodeOrSelf(value: string): string {
  try {
    return atob(value);
  } catch {
    return value;
  }
}
