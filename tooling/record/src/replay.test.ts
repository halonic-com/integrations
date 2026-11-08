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
        headers: { authorization: "Bearer <scrubbed:secret>" },
        body: { kind: "json", value: { query: "<scrubbed:content>" } },
      },
      response: { status: 200, headers: {}, body: { kind: "json", value: { items: [] } } },
    },
  ],
  scrubReport: [],
};

const bearer = { secret: "key", as: "bearer" } as const;

describe("replay", () => {
  it("answers a matching call with the recorded response and keeps what was sent", async () => {
    const recorded = replay(recording);
    const response = await recorded.http.fetch(url, {
      method: "POST",
      body: '{"query":"hi"}',
      auth: bearer,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    expect(recorded.sent.map((request) => request.body)).toEqual([{ query: "hi" }]);
    recorded.assertAllUsed();
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
    const recorded = replay(recording);
    expect(() => recorded.assertAllUsed()).toThrow("Used 0 of 1");
    await recorded.http.fetch(url, { method: "POST", auth: bearer });
    await expect(recorded.http.fetch(url, { method: "POST" })).rejects.toThrow("Unexpected call 2");
  });

  it("refuses a file that isn't a recording", () => {
    expect(() => replay({ format: "halonic.recording/0", exchanges: [] })).toThrow();
  });
});
