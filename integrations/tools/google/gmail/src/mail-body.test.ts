import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { attributionLine, withQuote, withSignature } from "./mail-body.ts";
import { type MessagePart, messageSchema } from "./message.ts";

const signature = "<div>Sam Example<br>Finance</div>";

describe("withSignature", () => {
  it("appends the signature to the plain body and builds an HTML body with it", () => {
    const signed = withSignature({ body: "Paid today.\n" }, signature);
    expect(signed.body).toBe("Paid today.\n\nSam Example\nFinance");
    expect(signed.html).toBe(
      '<div dir="ltr">Paid today.<br clear="all"><div><br></div><div dir="ltr" class="gmail_signature"><div>Sam Example<br>Finance</div></div></div>',
    );
  });

  it("adds it before </body> of an HTML document, and escapes the plain text it turns into HTML", () => {
    expect(
      withSignature({ body: "x", html: "<html><body><p>x</p></body></html>" }, signature).html,
    ).toMatch(/<p>x<\/p><br clear="all">.*gmail_signature.*<\/body><\/html>$/);
    expect(withSignature({ body: "a < b" }, signature).html).toContain("a &lt; b");
  });

  it("leaves the mail alone when the signature is empty or already in the body", () => {
    expect(withSignature({ body: "Paid." }, "")).toEqual({ body: "Paid." });
    const pasted = { body: "Paid.\n\nsam   example\nFINANCE" };
    expect(withSignature(pasted, signature)).toBe(pasted);
  });
});

const original = (payload: MessagePart, internalDate?: string) =>
  messageSchema.parse({ id: "m1", threadId: "t1", internalDate, payload });

const plainOriginal = original(
  {
    mimeType: "text/plain",
    headers: [{ name: "From", value: "Billing <billing@example.com>" }],
    body: { data: Buffer.from("Invoice attached.\r\n\r\nThanks", "utf8").toString("base64url") },
  },
  // 2 Nov 2026, 09:00 UTC.
  "1793610000000",
);

describe("attributionLine", () => {
  it("names the original's date in UTC and its sender", () => {
    expect(attributionLine(plainOriginal)).toBe(
      "On 2026-11-02 09:00 UTC, Billing <billing@example.com> wrote:",
    );
  });

  it("names only the sender when Gmail sends no date or one out of range", () => {
    expect(attributionLine({ ...plainOriginal, internalDate: "9".repeat(20) })).toBe(
      "Billing <billing@example.com> wrote:",
    );
    expect(
      attributionLine(original({ headers: [{ name: "From", value: "kim@example.com" }] })),
    ).toBe("kim@example.com wrote:");
  });
});

describe("withQuote", () => {
  it("quotes the plain original line by line, and as a blockquote in HTML", () => {
    const quoted = withQuote({ body: "Paid today." }, plainOriginal);
    expect(quoted.body).toBe(
      "Paid today.\n\nOn 2026-11-02 09:00 UTC, Billing <billing@example.com> wrote:\n> Invoice attached.\n>\n> Thanks",
    );
    expect(quoted.html).toMatch(/^<div dir="ltr">Paid today\.<\/div><br><div class="gmail_quote">/);
    expect(quoted.html).toContain("Billing &lt;billing@example.com&gt; wrote:");
    expect(quoted.html).toContain("Invoice attached.<br><br>Thanks</div></blockquote></div>");
  });

  it("quotes only the inside of an HTML original's body, without head or styles", () => {
    const html =
      "<!DOCTYPE html><html><head><style>p{}</style></head><body><p>Hello</p></body></html>";
    const quoted = withQuote(
      { body: "Hi" },
      original({ mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } }),
    );
    expect(quoted.html).toContain('padding-left:1ex"><p>Hello</p></blockquote>');
    expect(quoted.body).toContain("\n> Hello");
  });
});
