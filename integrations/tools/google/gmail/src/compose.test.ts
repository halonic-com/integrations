import { Buffer } from "node:buffer";
import type { IntegrationHttpClient } from "@halonicjs/adapters/integration-kit";
import { describe, expect, it } from "vitest";
import { GmailClient } from "./client.ts";
import { composeArguments, composeMail } from "./compose.ts";

const base = "https://gmail.googleapis.com/gmail/v1/users/me/";

const original = {
  id: "m1",
  threadId: "t1",
  internalDate: "1793610000000",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Billing <billing@example.com>" },
      { name: "Subject", value: "Invoice 1042" },
      { name: "Message-ID", value: "<2@mail.example.com>" },
      { name: "References", value: "<1@mail.example.com>" },
    ],
    body: { data: Buffer.from("Invoice attached.").toString("base64url") },
  },
};
const sendAs = {
  sendAs: [
    { sendAsEmail: "alias@example.com", signature: "<div>Alias</div>" },
    { sendAsEmail: "sam@example.com", isPrimary: true, signature: "<div>Sam</div>" },
  ],
};

/** A fake Gmail that answers by path, and the paths it was asked for. */
function fakeGmail(answers: Record<string, { status: number; body: unknown }>) {
  const asked: string[] = [];
  const http: IntegrationHttpClient = {
    async fetch(url: string) {
      const path = url.slice(base.length).split("?")[0] ?? "";
      asked.push(path);
      const answer = answers[path] ?? { status: 404, body: {} };
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    },
  };
  return { client: new GmailClient({ http, wait: async () => {} }), asked };
}

const compose = (args: Record<string, unknown>) => composeArguments.parse(args);
const mimeOf = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
const plainBodyOf = (mime: string) =>
  Buffer.from(/base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/.exec(mime)?.[1] ?? "", "base64").toString(
    "utf8",
  );

describe("composeMail", () => {
  it("appends the primary address's signature to a new mail, without threadId", async () => {
    const { client, asked } = fakeGmail({ "settings/sendAs": { status: 200, body: sendAs } });
    const mail = await composeMail(client, compose({ to: ["robin@example.com"], body: "Hi." }));
    expect(asked).toEqual(["settings/sendAs"]);
    expect(mail.threadId).toBeUndefined();
    const mime = mimeOf(mail.raw);
    expect(mime).toContain("To: robin@example.com\r\nSubject: \r\n");
    expect(plainBodyOf(mime)).toBe("Hi.\n\nSam");
  });

  it("replies in the original's thread: Re: subject, reply headers and the quote", async () => {
    const { client, asked } = fakeGmail({
      "messages/m1": { status: 200, body: original },
      "settings/sendAs": { status: 200, body: sendAs },
    });
    const mail = await composeMail(
      client,
      compose({ to: ["billing@example.com"], body: "Paid.", replyToMessageId: "m1" }),
    );
    expect(asked).toEqual(["messages/m1", "settings/sendAs"]);
    expect(mail.threadId).toBe("t1");
    const mime = mimeOf(mail.raw);
    expect(mime).toContain("Subject: Re: Invoice 1042\r\n");
    expect(mime).toContain(
      "In-Reply-To: <2@mail.example.com>\r\nReferences: <1@mail.example.com> <2@mail.example.com>\r\n",
    );
    expect(plainBodyOf(mime)).toBe(
      "Paid.\n\nSam\n\nOn 2026-11-02 09:00 UTC, Billing <billing@example.com> wrote:\n> Invoice attached.",
    );
  });

  it("keeps the caller's subject, and leaves out the signature and quote when asked", async () => {
    const { client, asked } = fakeGmail({ "messages/m1": { status: 200, body: original } });
    const mail = await composeMail(
      client,
      compose({
        to: ["billing@example.com"],
        subject: "Payment",
        body: "Paid.",
        replyToMessageId: "m1",
        signature: false,
        quoteOriginal: false,
      }),
    );
    expect(asked).toEqual(["messages/m1"]);
    const mime = mimeOf(mail.raw);
    expect(mime).toContain("Subject: Payment\r\n");
    expect(plainBodyOf(mime)).toBe("Paid.");
  });

  it("names only the recipients the caller gave", async () => {
    const { client } = fakeGmail({ "settings/sendAs": { status: 200, body: { sendAs: [] } } });
    const mime = mimeOf(
      (
        await composeMail(
          client,
          compose({ to: ["a@example.com"], bcc: ["b@example.com"], body: "x" }),
        )
      ).raw,
    );
    const headers = mime.split("\r\n\r\n")[0] ?? "";
    expect(headers.match(/@example\.com/g)).toHaveLength(2);
    expect(headers).not.toMatch(/^(From|Cc):/m);
  });

  it("needs at least one recipient in to", () => {
    expect(composeArguments.safeParse({ to: [], bcc: ["b@example.com"], body: "x" }).success).toBe(
      false,
    );
  });

  it("stops before anything is saved or sent when the signature can't be read", async () => {
    const { client, asked } = fakeGmail({ "settings/sendAs": { status: 403, body: {} } });
    await expect(
      composeMail(client, compose({ to: ["a@example.com"], body: "x" })),
    ).rejects.toMatchObject({ code: "not-allowed" });
    expect(asked).toEqual(["settings/sendAs"]);
  });
});
