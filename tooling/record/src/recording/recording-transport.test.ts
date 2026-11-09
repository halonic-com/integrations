import { describe, expect, it } from "vitest";
import { definePolicy } from "../scrub/policy.ts";
import { FAKE } from "../test/fakes.ts";
import { prepareRecording } from "./prepare-recording.ts";
import { createRecordingTransport, type HttpTransport } from "./recording-transport.ts";

/** A real transport stand-in: answers every call with `answer()` and keeps what it was sent. */
function fakeService(answer: () => Response) {
  const received: { url: string; init: RequestInit | undefined }[] = [];
  const transport: HttpTransport = {
    async fetch(url, init) {
      received.push({ url, init });
      return answer();
    },
  };
  return { transport, received };
}

function jsonAnswer(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createRecordingTransport", () => {
  it("captures the request as sent, key included, and the response", async () => {
    const service = fakeService(() => jsonAnswer({ id: "m1" }));
    const recording = createRecordingTransport(service.transport);

    await recording.transport.fetch("https://mail.example.com/v1/send", {
      method: "POST",
      headers: { authorization: `Bearer ${FAKE.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ raw: "Hello" }),
    });

    expect(recording.exchanges()).toEqual([
      {
        request: {
          method: "POST",
          url: "https://mail.example.com/v1/send",
          headers: [
            ["authorization", `Bearer ${FAKE.apiKey}`],
            ["content-type", "application/json"],
          ],
          body: '{"raw":"Hello"}',
        },
        response: {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: '{"id":"m1"}',
        },
      },
    ]);
  });

  it("passes the request on unchanged", async () => {
    const service = fakeService(() => jsonAnswer({}));
    const recording = createRecordingTransport(service.transport);
    const init: RequestInit = { method: "POST", body: "a=1", redirect: "manual" };

    await recording.transport.fetch("https://mail.example.com/v1/send", init);

    expect(service.received).toEqual([{ url: "https://mail.example.com/v1/send", init }]);
  });

  it("gives the integration the same answer, still readable", async () => {
    const service = fakeService(() => jsonAnswer({ id: "m1" }, 201));
    const recording = createRecordingTransport(service.transport);

    const response = await recording.transport.fetch("https://mail.example.com/v1/send");

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ id: "m1" });
  });

  it("keeps the URL the answer came from, which the kit logs", async () => {
    const answer = jsonAnswer({});
    Object.defineProperty(answer, "url", { value: "https://mail.example.com/v1/after" });
    const recording = createRecordingTransport(fakeService(() => answer).transport);

    const response = await recording.transport.fetch("https://mail.example.com/v1/before");

    expect(response.url).toBe("https://mail.example.com/v1/after");
  });

  it("captures a form body as text, with the content type it implies", async () => {
    const recording = createRecordingTransport(fakeService(() => jsonAnswer({})).transport);

    await recording.transport.fetch("https://auth.example.com/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: FAKE.randomToken }),
    });

    const [exchange] = recording.exchanges();
    expect(exchange?.request.body).toBe(
      `grant_type=refresh_token&refresh_token=${FAKE.randomToken}`,
    );
    expect(exchange?.request.headers).toContainEqual([
      "content-type",
      "application/x-www-form-urlencoded;charset=UTF-8",
    ]);
  });

  it("leaves out bodies that are empty", async () => {
    const recording = createRecordingTransport(
      fakeService(() => new Response(null, { status: 204 })).transport,
    );

    const response = await recording.transport.fetch("https://mail.example.com/v1/m1", {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(recording.exchanges()[0]?.request).not.toHaveProperty("body");
    expect(recording.exchanges()[0]?.response).not.toHaveProperty("body");
  });

  it("keeps each cookie as its own header", async () => {
    const headers = new Headers();
    headers.append("set-cookie", "a=1");
    headers.append("set-cookie", "b=2");
    const recording = createRecordingTransport(
      fakeService(() => new Response(null, { headers })).transport,
    );

    await recording.transport.fetch("https://mail.example.com/v1/login");

    expect(recording.exchanges()[0]?.response.headers).toEqual([
      ["set-cookie", "a=1"],
      ["set-cookie", "b=2"],
    ]);
  });

  it("reads a streamed answer in full, and the integration still gets it all", async () => {
    const stream = "event: delta\ndata: {}\n\nevent: done\ndata: {}\n\n";
    const recording = createRecordingTransport(
      fakeService(() => new Response(stream, { headers: { "content-type": "text/event-stream" } }))
        .transport,
    );

    const response = await recording.transport.fetch("https://api.example.com/v1/stream");

    expect(await response.text()).toBe(stream);
    expect(recording.exchanges()[0]?.response.body).toBe(stream);
  });

  it("keeps the exchanges in call order", async () => {
    let page = 0;
    const recording = createRecordingTransport(
      fakeService(() => jsonAnswer({ page: ++page })).transport,
    );

    await recording.transport.fetch("https://mail.example.com/v1/list?page=1");
    await recording.transport.fetch("https://mail.example.com/v1/list?page=2");

    expect(recording.exchanges().map((exchange) => exchange.response.body)).toEqual([
      '{"page":1}',
      '{"page":2}',
    ]);
  });

  it("records nothing when the network fails", async () => {
    const recording = createRecordingTransport({
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    await expect(recording.transport.fetch("https://mail.example.com/v1/list")).rejects.toThrow(
      "fetch failed",
    );
    expect(recording.exchanges()).toEqual([]);
  });

  it("refuses a request body sent as a stream, which it couldn't read and still send", async () => {
    const recording = createRecordingTransport(fakeService(() => jsonAnswer({})).transport);

    await expect(
      recording.transport.fetch("https://mail.example.com/v1/upload", {
        method: "POST",
        body: new ReadableStream(),
      }),
    ).rejects.toThrow("can't capture a request body sent as a stream");
  });

  it("captures what prepareRecording needs to scrub and save", async () => {
    const recording = createRecordingTransport(
      fakeService(() => jsonAnswer({ messages: [{ id: "m1", snippet: "Hi", from: FAKE.email }] }))
        .transport,
    );

    await recording.transport.fetch("https://mail.example.com/v1/messages", {
      headers: { authorization: `Bearer ${FAKE.plainKey}` },
    });
    const prepared = prepareRecording({
      integration: "example-mail",
      scenario: "list-messages",
      exchanges: recording.exchanges(),
      policy: definePolicy({ userContent: ["response.body.messages[*].snippet"] }),
      knownSecrets: [FAKE.plainKey],
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.text).not.toContain(FAKE.plainKey);
    expect(prepared.text).not.toContain(FAKE.email);
    expect(prepared.text).toContain("Bearer <scrubbed:secret>");
  });
});
