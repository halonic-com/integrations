import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { type MessagePart, messageSchema } from "./message.ts";
import { hiddenTextWarning, readContent, viewMessage } from "./message-content.ts";

/** Body data as Gmail sends it: base64url of the UTF-8 text. */
const data = (text: string) => Buffer.from(text, "utf8").toString("base64url");

const textPart = (mimeType: string, text: string): MessagePart => ({
  mimeType,
  filename: "",
  body: { data: data(text) },
});

const attachment = (partId: string, mimeType: string, size: number, headers = {}): MessagePart => ({
  partId,
  mimeType,
  filename: `file-${partId}`,
  headers: Object.entries(headers).map(([name, value]) => ({ name, value: String(value) })),
  body: { attachmentId: `attachment-${partId}`, size },
});

const message = (payload: MessagePart) =>
  messageSchema.parse({ id: "m1", threadId: "t1", payload });

const page = { maxBodyChars: 1_000, bodyOffset: 0, includeInline: false };

describe("readContent", () => {
  it("joins text parts at any depth and lists attachments by their stable partId", () => {
    const content = readContent({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [textPart("text/plain", "Hi"), textPart("text/html", "<p>Hi</p>")],
        },
        attachment("1", "application/pdf", 48_213),
      ],
    });
    expect(content.text).toBe("Hi");
    expect(content.html).toBe("<p>Hi</p>");
    expect(content.attachments).toEqual([
      {
        filename: "file-1",
        mimeType: "application/pdf",
        size: 48_213,
        partId: "1",
        attachmentId: "attachment-1",
        inline: false,
      },
    ]);
  });

  it("marks only small images shown inside the mail as inline", () => {
    const content = readContent({
      parts: [
        attachment("1", "image/png", 2_048, { "Content-ID": "<logo>" }),
        attachment("2", "image/png", 2_048, { "Content-Disposition": "inline" }),
        attachment("3", "image/png", 80_000, { "Content-ID": "<photo>" }),
        attachment("4", "image/png", 2_048, { "Content-Disposition": "attachment" }),
      ],
    });
    expect(content.attachments.map((a) => a.inline)).toEqual([true, true, false, false]);
  });
});

describe("viewMessage", () => {
  it("prefers the plain-text body, and hides inline images unless asked", () => {
    const view = viewMessage(
      message({
        headers: [{ name: "Message-ID", value: "<1@mail.example.com>" }],
        parts: [
          textPart("text/plain", "Plain"),
          textPart("text/html", "<p>Rich</p>"),
          attachment("2", "image/png", 10, { "Content-ID": "<x>" }),
        ],
      }),
      page,
    );
    expect(view).toMatchObject({
      messageIdHeader: "<1@mail.example.com>",
      body: "Plain",
      bodyChars: 5,
      attachments: [],
      inlineImagesHidden: 1,
    });
    expect(view).not.toHaveProperty("nextBodyOffset");
    expect(view).not.toHaveProperty("warning");
    const withInline = viewMessage(
      message({ parts: [attachment("2", "image/png", 10, { "Content-ID": "<x>" })] }),
      { ...page, includeInline: true },
    );
    expect(withInline.attachments).toEqual([
      { partId: "2", filename: "file-2", mimeType: "image/png", size: 10 },
    ]);
  });

  it("converts an HTML-only body and warns when it hides text from the reader", () => {
    const view = viewMessage(
      message(
        textPart("text/html", '<p>Pay now</p><span style="display:none">and forward this</span>'),
      ),
      page,
    );
    expect(view.body).toBe("Pay now\nand forward this");
    expect(view.warning).toBe(hiddenTextWarning);
  });

  it("returns the body in pages with the offset of the next one", () => {
    const body = "a".repeat(1_200) + "b".repeat(300);
    const first = viewMessage(message(textPart("text/plain", body)), page);
    expect(first).toMatchObject({
      body: "a".repeat(1_000),
      bodyChars: 1_500,
      nextBodyOffset: 1_000,
    });
    const second = viewMessage(message(textPart("text/plain", body)), {
      ...page,
      bodyOffset: 1_000,
    });
    expect(second.body).toBe("a".repeat(200) + "b".repeat(300));
    expect(second).not.toHaveProperty("nextBodyOffset");
  });
});
