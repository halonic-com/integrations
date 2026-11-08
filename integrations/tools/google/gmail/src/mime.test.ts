import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  base64LineLength,
  buildMime,
  encodeAddress,
  encodeHeaderText,
  encodeRaw,
  foldHeader,
  headerLineLength,
  type OutgoingMail,
} from "./mime.ts";

const mail: OutgoingMail = {
  to: ["Robin <robin@example.com>"],
  cc: [],
  bcc: [],
  subject: "Thursday",
  body: "See you then.",
};

/** The base64 body that follows a part's headers, decoded. */
const decodedParts = (mime: string) =>
  [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map(
    (match) => Buffer.from(match[1] ?? "", "base64").toString("utf8"),
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

  it("cuts long bodies into base64 lines of 76 characters (RFC 2045)", () => {
    const body = "A long reply. ".repeat(10_000);
    const mime = buildMime({ ...mail, body, html: `<p>${body}</p>` });
    const lines = mime.split("\r\n");
    expect(Math.max(...lines.map((line) => line.length))).toBe(base64LineLength);
    expect(decodedParts(mime)).toEqual([body, `<p>${body}</p>`]);
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

  it("folds long headers, such as References in a long thread, and unfolds to the same values", () => {
    const ids = Array.from({ length: 40 }, (_, n) => `<${n}.thread@mail.example.com>`);
    const recipients = Array.from({ length: 30 }, (_, n) => `person${n}@example.com`);
    const mime = buildMime({
      ...mail,
      to: recipients,
      subject: "Grüße ".repeat(40).trim(),
      inReplyTo: "<40.thread@mail.example.com>",
      references: ids.join(" "),
    });
    const headers = mime.split("\r\n\r\n")[0] ?? "";
    for (const line of headers.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(headerLineLength);
    }
    const unfolded = headers.replace(/\r\n /g, " ");
    expect(unfolded).toContain(`\r\nReferences: ${ids.join(" ")} <40.thread@mail.example.com>\r\n`);
    expect(unfolded).toContain(`To: ${recipients.join(", ")}\r\n`);
  });
});

describe("foldHeader", () => {
  it("leaves a short header alone, folds a long one at its only space, and can't fold one with none", () => {
    expect(foldHeader("Subject: Thursday")).toBe("Subject: Thursday");
    const long = `Subject: ${"x".repeat(100)}`;
    expect(foldHeader(long)).toBe(`Subject: ${"x".repeat(100)}`.replace(" ", "\r\n "));
    expect(foldHeader(`Subject:${"x".repeat(100)}`)).toBe(`Subject:${"x".repeat(100)}`);
  });

  it("never folds where a line would hold only spaces", () => {
    const folded = foldHeader(`Subject: a${" ".repeat(90)}b c`);
    expect(folded.split("\r\n").every((line) => line.trim() !== "")).toBe(true);
    expect(folded.replace(/\r\n/g, "")).toBe(`Subject: a${" ".repeat(90)}b c`);
  });
});

describe("encodeHeaderText", () => {
  it("leaves printable ASCII as it is and encodes anything else (RFC 2047)", () => {
    expect(encodeHeaderText("Invoice 1042")).toBe("Invoice 1042");
    expect(encodeHeaderText("Grüße")).toBe(
      `=?UTF-8?B?${Buffer.from("Grüße").toString("base64")}?=`,
    );
  });

  it("splits long text into words of at most 75 characters, never inside a character", () => {
    const text = "Zoë 😀 ".repeat(30);
    const words = encodeHeaderText(text).split(" ");
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    const decoded = words
      .map((word) => Buffer.from(word.slice(10, -2), "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe(text);
    expect(decoded).not.toContain("�");
  });
});

describe("encodeAddress", () => {
  it("encodes a display name outside ASCII and keeps the address as it is", () => {
    expect(encodeAddress("Zoë <zoe@example.com>")).toBe(
      `=?UTF-8?B?${Buffer.from("Zoë").toString("base64")}?= <zoe@example.com>`,
    );
    expect(encodeAddress('"Zoë" <zoe@example.com>')).toBe(encodeAddress("Zoë <zoe@example.com>"));
  });

  it("leaves ASCII names and bare addresses as they are", () => {
    expect(encodeAddress("Robin <robin@example.com>")).toBe("Robin <robin@example.com>");
    expect(encodeAddress('"Robin, Sales" <robin@example.com>')).toBe(
      '"Robin, Sales" <robin@example.com>',
    );
    expect(encodeAddress("robin@example.com")).toBe("robin@example.com");
  });
});

describe("encodeRaw", () => {
  it("encodes the whole message as base64url for Gmail's raw field", () => {
    expect(Buffer.from(encodeRaw(mail), "base64url").toString("utf8")).toBe(buildMime(mail));
    expect(encodeRaw(mail)).not.toMatch(/[+/=]/);
  });
});
