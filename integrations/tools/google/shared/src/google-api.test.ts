import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GoogleError } from "./errors.ts";
import { type GoogleApiOptions, googleApi } from "./google-api.ts";
import type { HttpClient, HttpRequestInit, HttpResponse } from "./http.ts";
import { fakeWait } from "./test/fake-wait.ts";

const listUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=subject%3Atest";
const sendUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const messageSchema = z.object({ id: z.string() });

/** A response the fake client hands back. */
function response(status: number, body = "", headers: Record<string, string> = {}): HttpResponse {
  const lowerCase = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    status,
    ok: status >= 200 && status <= 299,
    headers: { get: (name) => lowerCase.get(name.toLowerCase()) ?? null },
    text: async () => body,
  };
}

/** Answers with the given responses in turn and keeps every request it got. */
class FakeHttp implements HttpClient {
  readonly requests: { url: string; init: HttpRequestInit | undefined }[] = [];
  readonly #responses: HttpResponse[];

  constructor(...responses: HttpResponse[]) {
    this.#responses = responses;
  }

  async fetch(url: string, init?: HttpRequestInit): Promise<HttpResponse> {
    this.requests.push({ url, init });
    const next = this.#responses.shift();
    if (next === undefined) {
      throw new Error("The test sent more requests than it expected.");
    }
    return next;
  }
}

function setUp(http: FakeHttp, options: Partial<GoogleApiOptions> = {}) {
  const { wait, waits } = fakeWait();
  const google = googleApi(
    { http, wait },
    { secret: "google-account", service: "Gmail", ...options },
  );
  return { google, waits };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(GoogleError);
  return (error as GoogleError).code;
}

describe("GoogleApi requests", () => {
  it("names the secret for the kit and never handles a token", async () => {
    const http = new FakeHttp(response(200, '{"id":"m1"}'));
    const { google } = setUp(http);
    await google.getJson(listUrl, messageSchema);
    expect(http.requests[0]?.init).toMatchObject({
      method: "GET",
      auth: { secret: "google-account", as: "bearer" },
      headers: { accept: "application/json" },
    });
    expect(JSON.stringify(http.requests[0]?.init)).not.toMatch(/authorization/i);
  });

  it("passes the signal on", async () => {
    const http = new FakeHttp(response(200, "text"));
    const { google } = setUp(http);
    const signal = new AbortController().signal;
    await google.getText(listUrl, signal);
    expect(http.requests[0]?.init?.signal).toBe(signal);
  });

  it("sends JSON with a POST and reads the answer", async () => {
    const http = new FakeHttp(response(200, '{"id":"m1","threadId":"t1"}'));
    const { google } = setUp(http);
    const sent = await google.postJson(sendUrl, { raw: "UmF3" }, messageSchema);
    expect(sent).toEqual({ id: "m1" });
    expect(http.requests[0]?.init).toMatchObject({
      method: "POST",
      body: '{"raw":"UmF3"}',
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  });

  it.each([
    ["a body that isn't JSON", "<html>alex@example.com</html>"],
    ["an empty body", ""],
    ["a body the schema refuses", '{"id":42,"note":"alex@example.com"}'],
  ])("turns %s into unexpected-response without quoting it", async (_case, body) => {
    const { google } = setUp(new FakeHttp(response(200, body)));
    const error = await google.getJson(listUrl, messageSchema).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(GoogleError);
    expect((error as GoogleError).code).toBe("unexpected-response");
    expect((error as GoogleError).message).not.toMatch(/example\.com|html|42/);
    expect((error as GoogleError).cause).toBeUndefined();
  });

  it("maps an error status with the shared error mapping", async () => {
    const body = JSON.stringify({ error: { status: "NOT_FOUND", message: "alex@example.com" } });
    const { google } = setUp(new FakeHttp(response(404, body)));
    const error = await google.getJson(listUrl, messageSchema).catch((thrown: unknown) => thrown);
    expect((error as GoogleError).message).toBe(
      "Gmail found nothing at gmail.googleapis.com/gmail/v1/users/me/messages (status 404, NOT_FOUND).",
    );
  });

  it("lets the kit's own errors through unchanged and doesn't retry them", async () => {
    const refused = new Error("host-not-allowed");
    const http: HttpClient = { fetch: async () => Promise.reject(refused) };
    const google = googleApi(
      { http, wait: fakeWait().wait },
      { secret: "google-account", service: "Gmail" },
    );
    await expect(google.getJson(listUrl, messageSchema)).rejects.toBe(refused);
  });
});

describe("GoogleApi retries", () => {
  it.each([429, 500, 503])("retries a GET after %i and succeeds", async (status) => {
    const http = new FakeHttp(response(status), response(200, '{"id":"m1"}'));
    const { google, waits } = setUp(http);
    expect(await google.getJson(listUrl, messageSchema)).toEqual({ id: "m1" });
    expect(waits).toEqual([1_000]);
  });

  it("sends a GET at most three times", async () => {
    const http = new FakeHttp(response(503), response(503), response(503));
    const { google, waits } = setUp(http);
    expect(await codeOf(google.getJson(listUrl, messageSchema))).toBe("unavailable");
    expect(http.requests).toHaveLength(3);
    expect(waits).toEqual([1_000, 2_000]);
  });

  it("waits as long as retry-after asks", async () => {
    const http = new FakeHttp(response(429, "", { "Retry-After": "12" }), response(200, "ok"));
    const { google, waits } = setUp(http);
    await google.getText(listUrl);
    expect(waits).toEqual([12_000]);
  });

  it("measures a retry-after date against the response's date header", async () => {
    const http = new FakeHttp(
      response(503, "", {
        date: "Thu, 15 Jan 2026 12:00:00 GMT",
        "retry-after": "Thu, 15 Jan 2026 12:00:05 GMT",
      }),
      response(200, "ok"),
    );
    const { google, waits } = setUp(http);
    await google.getText(listUrl);
    expect(waits).toEqual([5_000]);
  });

  it("gives up at once when retry-after is longer than 30 s", async () => {
    const http = new FakeHttp(response(429, "", { "retry-after": "120" }));
    const { google, waits } = setUp(http);
    expect(await codeOf(google.getText(listUrl))).toBe("rate-limited");
    expect(waits).toEqual([]);
  });

  it.each([400, 401, 403, 404, 408])("doesn't retry a %i", async (status) => {
    const http = new FakeHttp(response(status));
    const { google } = setUp(http);
    await codeOf(google.getText(listUrl));
    expect(http.requests).toHaveLength(1);
  });

  it("doesn't retry a 403 rate limit: rule 10 allows only 429 and 5xx", async () => {
    const body = JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } });
    const http = new FakeHttp(response(403, body));
    const { google } = setUp(http);
    expect(await codeOf(google.getText(listUrl))).toBe("rate-limited");
    expect(http.requests).toHaveLength(1);
  });

  it("never retries a POST", async () => {
    const http = new FakeHttp(response(503));
    const { google } = setUp(http);
    expect(await codeOf(google.postJson(sendUrl, {}, messageSchema))).toBe("unavailable");
    expect(http.requests).toHaveLength(1);
  });

  it("never retries a DELETE, even one marked repeatable", async () => {
    const http = new FakeHttp(response(503));
    const { google } = setUp(http);
    await codeOf(google.send({ method: "DELETE", url: sendUrl, repeatable: true }));
    expect(http.requests).toHaveLength(1);
  });

  it("retries a PUT the caller marked repeatable", async () => {
    const http = new FakeHttp(response(503), response(200));
    const { google } = setUp(http);
    await google.send({ method: "PUT", url: sendUrl, repeatable: true });
    expect(http.requests).toHaveLength(2);
  });

  it("waits with the call's own signal", async () => {
    const http = new FakeHttp(response(503), response(200, "ok"));
    const signals: (AbortSignal | undefined)[] = [];
    const google = googleApi(
      { http, wait: async (_ms, signal) => void signals.push(signal) },
      { secret: "google-account", service: "Gmail" },
    );
    const signal = new AbortController().signal;
    await google.getText(listUrl, signal);
    expect(signals).toEqual([signal]);
  });

  it("stops when the call is cancelled before the wait", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled");
    controller.abort(cancelled);
    const http = new FakeHttp(response(503));
    const { google, waits } = setUp(http);
    await expect(google.getText(listUrl, controller.signal)).rejects.toBe(cancelled);
    expect(http.requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });
});
