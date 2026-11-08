import { describe, expect, it } from "vitest";
import { headerValue, messageSchema, summarize } from "./message.ts";

describe("headerValue", () => {
  const headers = [
    { name: "From", value: "Billing <billing@example.com>" },
    { name: "subject", value: "Invoice 1042" },
  ];

  it("finds a header whatever its case", () => {
    expect(headerValue(headers, "Subject")).toBe("Invoice 1042");
    expect(headerValue(headers, "FROM")).toBe("Billing <billing@example.com>");
  });

  it("is undefined for a missing header, so the field is left out of the result", () => {
    expect(headerValue(headers, "Cc")).toBeUndefined();
    expect(headerValue(undefined, "From")).toBeUndefined();
  });
});

describe("summarize", () => {
  it("takes the summary headers, the labels and the snippet", () => {
    const message = messageSchema.parse({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX"],
      snippet: "See you then.",
      payload: {
        headers: [
          { name: "From", value: "robin@example.com" },
          { name: "To", value: "sam@example.com" },
          { name: "Subject", value: "Thursday" },
          { name: "Date", value: "Tue, 3 Nov 2026 14:30:00 +0000" },
          { name: "Received", value: "from mail.example.com" },
        ],
      },
    });
    expect(JSON.parse(JSON.stringify(summarize(message)))).toEqual({
      id: "m1",
      threadId: "t1",
      from: "robin@example.com",
      to: "sam@example.com",
      subject: "Thursday",
      date: "Tue, 3 Nov 2026 14:30:00 +0000",
      labels: ["INBOX"],
      snippet: "See you then.",
    });
  });

  it("copes with a message without payload or labels", () => {
    const summary = summarize(messageSchema.parse({ id: "m1", threadId: "t1" }));
    expect(summary).toMatchObject({ id: "m1", labels: [], from: undefined, snippet: undefined });
  });
});
