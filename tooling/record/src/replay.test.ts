import { describe, expect, it } from "vitest";
import { RECORDING_FORMAT, type RecordingFile } from "./format.ts";
import { replay } from "./replay.ts";

const url = "https://api.example.com/v1/items";

const recording: RecordingFile = {
  format: RECORDING_FORMAT,
  integration: "example",
  scenario: "list-items",
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

describe("replay", () => {
  it("answers a matching call with the recorded response and keeps what was sent", async () => {
    const recorded = replay(recording, { policy });
    const response = await recorded.http.fetch(url, matching);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    expect(recorded.sent.map((request) => request.body)).toEqual([{ query: "hi", limit: 10 }]);
    recorded.assertAllUsed();
  });

  it("gives the recorded headers and the body as text", async () => {
    const withHeaders: RecordingFile = {
      ...recording,
      exchanges: [
        {
          transport: "http",
          request: { method: "GET", url, headers: {}, body: { kind: "empty" } },
          response: {
            status: 429,
            headers: { "retry-after": "2" },
            body: { kind: "json", value: { error: { code: 429 } } },
          },
        },
        {
          transport: "http",
          request: { method: "GET", url, headers: {}, body: { kind: "empty" } },
          response: { status: 204, headers: {}, body: { kind: "empty" } },
        },
      ],
    };
    const recorded = replay(withHeaders);
    const limited = await recorded.http.fetch(url);
    expect(limited.headers.get("Retry-After")).toBe("2");
    expect(limited.headers.get("content-type")).toBeNull();
    expect(await limited.text()).toBe('{"error":{"code":429}}');
    expect(await (await recorded.http.fetch(url)).text()).toBe("");
  });

  it("fails a call to another URL or method", async () => {
    await expect(replay(recording).http.fetch(url)).rejects.toThrow(
      `Expected POST ${url}, got GET ${url}`,
    );
  });

  it("fails when the key goes somewhere the recording doesn't have it", async () => {
    const auth = { secret: "key", as: "header", header: "X-Api-Key" } as const;
    await expect(replay(recording).http.fetch(url, { method: "POST", auth })).rejects.toThrow(
      "no key in the x-api-key header",
    );
  });

  it("fails an unexpected call and an unused exchange", async () => {
    const recorded = replay(recording, { policy });
    expect(() => recorded.assertAllUsed()).toThrow("Used 0 of 1");
    await recorded.http.fetch(url, matching);
    await expect(recorded.http.fetch(url, matching)).rejects.toThrow("Unexpected call 2");
  });

  it("fails when the recording has a key the request doesn't ask for", async () => {
    await expect(replay(recording).http.fetch(url, { method: "POST" })).rejects.toThrow(
      "a key in the authorization header; the request doesn't ask for one",
    );
  });

  it("expects no key for an optional secret the workspace hasn't set up", async () => {
    const withoutKey: RecordingFile = {
      ...recording,
      exchanges: recording.exchanges.map((exchange) => ({
        ...exchange,
        request: { ...exchange.request, headers: { "content-type": "application/json" } },
      })),
    };
    const recorded = replay(withoutKey, { policy, unsetSecrets: ["key"] });
    await recorded.http.fetch(url, matching);
    recorded.assertAllUsed();
    await expect(
      replay(recording, { policy, unsetSecrets: ["key"] }).http.fetch(url, matching),
    ).rejects.toThrow("a key in the authorization header; the request doesn't ask for one");
  });

  it("refuses a file that isn't a recording", () => {
    expect(() => replay({ format: "halonic.recording/0", exchanges: [] })).toThrow();
  });
});

describe("replay of a session", () => {
  const sessionUrl = "https://docs.example.com/mcp";
  const json = { "content-type": "application/json" };
  const session = { "mcp-session-id": "scrubbed-secret-1" };

  const sessionRecording: RecordingFile = {
    format: RECORDING_FORMAT,
    integration: "example",
    scenario: "session",
    exchanges: [
      {
        transport: "http",
        request: { method: "POST", url: sessionUrl, headers: json, body: { kind: "empty" } },
        response: {
          status: 200,
          headers: { ...json, ...session },
          body: { kind: "json", value: { ready: true } },
        },
      },
      {
        transport: "http",
        request: {
          method: "POST",
          url: sessionUrl,
          headers: { ...json, ...session },
          body: { kind: "empty" },
        },
        response: {
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: {
            kind: "sse",
            value: [
              { event: "message", data: { text: "hello" } },
              { event: "ping", data: "two\nlines" },
            ],
          },
        },
      },
      {
        transport: "http",
        request: { method: "DELETE", url: sessionUrl, headers: session, body: { kind: "empty" } },
        response: { status: 200, headers: {}, body: { kind: "empty" } },
      },
    ],
    scrubReport: [],
  };

  it("gives back headers, text and a byte stream, and passes the session id on", async () => {
    const recorded = replay(sessionRecording);
    const first = await recorded.http.fetch(sessionUrl, { method: "POST", headers: json });
    const sessionId = first.headers.get("MCP-Session-Id");
    expect(sessionId).toBe("scrubbed-secret-1");
    expect(await first.text()).toBe('{"ready":true}');

    const second = await recorded.http.fetch(sessionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": `${sessionId}` },
    });
    const reader = second.body?.getReader();
    const chunk = await reader?.read();
    expect(chunk?.done).toBe(false);
    expect(new TextDecoder().decode(chunk?.value)).toBe(
      'event: message\ndata: {"text":"hello"}\n\nevent: ping\ndata: two\ndata: lines\n\n',
    );
    expect((await reader?.read())?.done).toBe(true);
    await expect(second.json()).rejects.toThrow(SyntaxError);

    const third = await recorded.http.fetch(sessionUrl, { method: "DELETE", headers: session });
    expect(third.body).toBeNull();
    recorded.assertAllUsed();
  });

  it("fails a header with another value than the recording", async () => {
    const headers = { "content-type": "text/plain" };
    await expect(
      replay(sessionRecording).http.fetch(sessionUrl, { method: "POST", headers }),
    ).rejects.toThrow(
      'The content-type header is "text/plain"; the recording has "application/json".',
    );
  });

  it("fails when the request leaves out a session id the recording has", async () => {
    const recorded = replay(sessionRecording);
    await recorded.http.fetch(sessionUrl, { method: "POST", headers: json });
    await expect(
      recorded.http.fetch(sessionUrl, { method: "POST", headers: json }),
    ).rejects.toThrow("The request has no mcp-session-id header; the recording has one.");
  });

  it("lets a header through that the recorder left out", async () => {
    const headers = { ...json, "idempotency-key": "k1" };
    const response = await replay(sessionRecording).http.fetch(sessionUrl, {
      method: "POST",
      headers,
    });
    expect(response.status).toBe(200);
  });
});
