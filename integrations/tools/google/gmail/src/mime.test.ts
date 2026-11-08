import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { buildMime, encodeHeaderText, encodeRaw, type OutgoingMail } from "./mime.ts";

const mail: OutgoingMail = {
  to: ["Robin <robin@example.com>"],
  cc: [],
  bcc: [],
  subject: "Thursday",
  body: "See you then.",
};

/** The base64 body that follows a part's headers, decoded. */
const decodedParts = (mime: string) =>
  [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=]+)/g)].map((match) =>
    Buffer.from(match[1] ?? "", "base64").toString("utf8"),
  );

describe("buildMime", () => {
  it("builds a plain-text message without From: Gmail fills that in", () => {
    const mime = buildMime(mail);
    expect(mime.split("\r\n").slice(0, 5)).toEqual([
      "To: Robin <robin@example.com>",
      "Subject: Thursday",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ]);
    expect(decodedParts(mime)).toEqual(["See you then."]);
  });

  it("names only the recipients the caller gave, Bcc included", () => {
    const mime = buildMime({
      ...mail,
      cc: ["kim@example.com"],
      bcc: ["records@example.com", "x@example.com"],
    });
    expect(mime).toContain("\r\nCc: kim@example.com\r\n");
    expect(mime).toContain("\r\nBcc: records@example.com, x@example.com\r\n");
  });

  it("sends an HTML body next to the plain one, with a fixed boundary", () => {
    const mime = buildMime({ ...mail, html: "<p>See you then.</p>" });
    expect(mime).toContain(
      'Content-Type: multipart/alternative; boundary="halonic_alternative_part"',
    );
    expect(decodedParts(mime)).toEqual(["See you then.", "<p>See you then.</p>"]);
    expect(mime.endsWith("\r\n--halonic_alternative_part--")).toBe(true);
  });

  it("refers to the original in a reply", () => {
    const mime = buildMime({
      ...mail,
      inReplyTo: "<2@mail.example.com>",
      references: "<1@mail.example.com>",
    });
    expect(mime).toContain(
      "\r\nIn-Reply-To: <2@mail.example.com>\r\nReferences: <1@mail.example.com> <2@mail.example.com>\r\n",
    );
  });

  it("never lets a line break in a value start a new header", () => {
    const mime = buildMime({
      ...mail,
      to: ["robin@example.com\r\nBcc: someone@example.com"],
      subject: "Hi\r\nBcc: other@example.com",
      inReplyTo: "<2@mail.example.com>\nBcc: third@example.com",
    });
    const headerNames = mime
      .split("\r\n\r\n")[0]
      ?.split("\r\n")
      .map((line) => line.split(":")[0]);
    expect(headerNames).not.toContain("Bcc");
    expect(mime).toContain("To: robin@example.com Bcc: someone@example.com\r\n");
  });
});

describe("encodeHeaderText", () => {
  it("leaves printable ASCII as it is and encodes anything else (RFC 2047)", () => {
    expect(encodeHeaderText("Invoice 1042")).toBe("Invoice 1042");
    expect(encodeHeaderText("Grüße")).toBe(
      `=?UTF-8?B?${Buffer.from("Grüße").toString("base64")}?=`,
    );
  });
});

describe("encodeRaw", () => {
  it("encodes the whole message as base64url for Gmail's raw field", () => {
    expect(Buffer.from(encodeRaw(mail), "base64url").toString("utf8")).toBe(buildMime(mail));
    expect(encodeRaw(mail)).not.toMatch(/[+/=]/);
  });
});
