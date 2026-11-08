import { describe, expect, it } from "vitest";
import { RECORDING_FORMAT, type RecordingFile } from "../format.ts";
import { replay } from "../replay.ts";

const url = "https://api.example.com/v1/items";

const recording: RecordingFile = {
  format: RECORDING_FORMAT,
  integration: "example",
  scenario: "search-items",
  exchanges: [
    {
      transport: "http",
      request: {
        method: "POST",
        url,
        headers: {
          authorization: "Bearer <scrubbed:secret>",
          "content-type": "application/json",
        },
        body: { kind: "json", value: { query: "<scrubbed:content>", limit: 10 } },
      },
      response: { status: 200, headers: {}, body: { kind: "json", value: { items: [] } } },
    },
  ],
  scrubReport: [],
};

const bearer = { secret: "key", as: "bearer" } as const;

/** What the example integration declares in its `recording` section. */
const policy = { userContent: ["request.body.query"] };

/** A request that matches the recording, scrubbed. */
const matching = { method: "POST", body: '{"query":"hi","limit":10}', auth: bearer };

describe("replay of a request body", () => {
  it("compares JSON by value, so the field order doesn't matter", async () => {
    const recorded = replay(recording, { policy });
    await recorded.http.fetch(url, { ...matching, body: '{"limit":10,"query":"hi"}' });
    recorded.assertAllUsed();
  });

  it("fails a JSON body with another value and names the field", async () => {
    await expect(
      replay(recording, { policy }).http.fetch(url, {
        ...matching,
        body: '{"query":"hi","limit":5}',
      }),
    ).rejects.toThrow(
      "The request body differs from the recording at request.body.limit: the request sends 5; the recording has 10.",
    );
  });

  it("fails a field the recording doesn't have", async () => {
    const body = '{"query":"hi","limit":10,"page":2}';
    await expect(
      replay(recording, { policy }).http.fetch(url, { ...matching, body }),
    ).rejects.toThrow("at request.body.page: the request sends 2; the recording has nothing.");
  });

  it("scrubs the sent body with the same rules, so an address matches its stand-in", async () => {
    const withAddress = withRequestBody({
      kind: "json",
      value: { query: "<scrubbed:content>", limit: 10, to: "person1@example.com" },
    });
    const body = '{"query":"hi","limit":10,"to":"someone@mail.test"}';
    const recorded = replay(withAddress, { policy });
    await recorded.http.fetch(url, { ...matching, body });
    recorded.assertAllUsed();
  });

  it("points at the policy when user content doesn't match", async () => {
    await expect(replay(recording).http.fetch(url, matching)).rejects.toThrow(
      'at request.body.query: the request sends "hi"; the recording has "<scrubbed:content>". If it is the user\'s own content, pass the integration\'s recording policy to replay.',
    );
  });

  it("fails a request without a body when the recording has one", async () => {
    await expect(
      replay(recording, { policy }).http.fetch(url, { method: "POST", auth: bearer }),
    ).rejects.toThrow(
      "The request body differs from the recording: the request sends no body; the recording has JSON.",
    );
  });

  describe("as text", () => {
    const upload = (textType: string) =>
      [
        "--b",
        "Content-Type: application/json; charset=UTF-8",
        "",
        '{"name":"Notes"}',
        "--b",
        `Content-Type: ${textType}`,
        "",
        "Bring the plan.",
        "--b--",
      ].join("\r\n");
    const multipart = withRequestBody(
      {
        kind: "text",
        contentType: "multipart/related",
        value: upload("text/plain; charset=UTF-8"),
      },
      {
        authorization: "Bearer <scrubbed:secret>",
        "content-type": "multipart/related; boundary=b",
      },
    );

    it("passes a multipart upload that matches", async () => {
      const recorded = replay(multipart);
      const body = upload("text/plain; charset=UTF-8");
      await recorded.http.fetch(url, { method: "POST", body, auth: bearer });
      expect(recorded.sent.map((request) => request.body)).toEqual([body]);
      recorded.assertAllUsed();
    });

    it("fails a multipart upload whose part has another content type, and names the line", async () => {
      const body = upload("text/plain");
      await expect(
        replay(multipart).http.fetch(url, { method: "POST", body, auth: bearer }),
      ).rejects.toThrow(
        'in line 6: the request sends "Content-Type: text/plain\\r"; the recording has "Content-Type: text/plain; charset=UTF-8\\r".',
      );
    });

    it("fails a body of another content type", async () => {
      const headers = { "Content-Type": "text/plain" };
      await expect(
        replay(multipart).http.fetch(url, { method: "POST", headers, body: "hi", auth: bearer }),
      ).rejects.toThrow('The content-type header is "text/plain"');
    });
  });

  it("compares form data and leaves out the key the kit adds to it", async () => {
    const form = withRequestBody(
      {
        kind: "form",
        value: [
          ["q", "hi"],
          ["api_key", "<scrubbed:secret>"],
        ],
      },
      { "content-type": "application/x-www-form-urlencoded" },
    );
    const auth = { secret: "key", as: "form", field: "api_key" } as const;
    const recorded = replay(form);
    await recorded.http.fetch(url, { method: "POST", body: "q=hi", auth });
    recorded.assertAllUsed();
    await expect(
      replay(form).http.fetch(url, { method: "POST", body: "q=bye", auth }),
    ).rejects.toThrow('in line 1: the request sends "q=bye"; the recording has "q=hi".');
  });
});

/** The example recording with another request body and request headers. */
function withRequestBody(
  body: RecordingFile["exchanges"][number]["request"]["body"],
  headers: Record<string, string> = {
    authorization: "Bearer <scrubbed:secret>",
    "content-type": "application/json",
  },
): RecordingFile {
  return {
    ...recording,
    exchanges: recording.exchanges.map((exchange) => ({
      ...exchange,
      request: { ...exchange.request, headers, body },
    })),
  };
}
