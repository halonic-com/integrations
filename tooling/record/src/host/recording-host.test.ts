import { describe, expect, it } from "vitest";
import type { RecordValues } from "../command/record-values.ts";
import { readRecordingSheet } from "../command/sheet.ts";
import type { HttpTransport } from "../recording/recording-transport.ts";
import { FAKE } from "../test/fakes.ts";
import { createRecordingHost } from "./recording-host.ts";
import { HostRefused } from "./refused.ts";

const modelSheet = readRecordingSheet(`id: model-example
hosts:
  - api.example.com
  - files.example.com
secrets:
  example-key:
    hosts: [api.example.com]
    as: header
    header: x-api-key
`);

const serverSheet = readRecordingSheet(`id: tool-example-server
hosts:
  - fromSetting: url
secrets:
  server-key:
    hosts: [{ fromSetting: url }]
    as: bearer
    optional: true
`);

/** Answers with `answers` in turn, the last one over and over, and keeps what it was sent. */
function fakeTransport(...answers: (() => Response)[]) {
  const sent: { url: string; headers: Headers; method: string | undefined }[] = [];
  const transport: HttpTransport = {
    async fetch(url, init) {
      sent.push({ url, headers: new Headers(init?.headers), method: init?.method });
      const answer = answers[Math.min(sent.length - 1, answers.length - 1)] as () => Response;
      return answer();
    },
  };
  return { transport, sent };
}

const ok = () => new Response("{}", { headers: { "content-type": "application/json" } });
const redirect =
  (location: string, status = 302) =>
  () =>
    new Response(null, { status, headers: { location } });

function values(
  secrets: Record<string, string>,
  settings: Record<string, string> = {},
): RecordValues {
  return { secrets: new Map(Object.entries(secrets)), settings };
}

const withKey = values({ "example-key": FAKE.apiKey });

describe("createRecordingHost", () => {
  it("places the key where the sheet says, and sends the request on", async () => {
    const service = fakeTransport(ok);
    const { host } = createRecordingHost(modelSheet, withKey, service.transport);

    await host.http.fetch("https://api.example.com/v1/messages", {
      method: "post",
      auth: { secret: "example-key", as: "header", header: "X-Api-Key" },
    });

    expect(service.sent).toHaveLength(1);
    expect(service.sent[0]?.url).toBe("https://api.example.com/v1/messages");
    expect(service.sent[0]?.method).toBe("POST");
    expect(service.sent[0]?.headers.get("x-api-key")).toBe(FAKE.apiKey);
  });

  it("refuses a host that isn't in the sheet, and remembers it even when the code catches it", async () => {
    const service = fakeTransport(ok);
    const recording = createRecordingHost(modelSheet, withKey, service.transport);

    await expect(recording.host.http.fetch("https://other.example.com/")).rejects.toThrow(
      "other.example.com is not one of the hosts in its permission sheet",
    );
    expect(service.sent).toEqual([]);
    expect(recording.refusals().map((refusal) => refusal.code)).toEqual(["host-not-allowed"]);
  });

  it.each([
    [
      "a placement the sheet doesn't give",
      { secret: "example-key", as: "bearer" },
      "placement-not-in-sheet",
    ],
    [
      "a secret the sheet doesn't declare",
      { secret: "other-key", as: "bearer" },
      "secret-not-declared",
    ],
  ])("refuses %s, before anything is sent", async (_what, auth, code) => {
    const service = fakeTransport(ok);
    const { host } = createRecordingHost(modelSheet, withKey, service.transport);

    const failed = host.http.fetch("https://api.example.com/v1", { auth: auth as never });

    await expect(failed).rejects.toMatchObject({ code });
    expect(service.sent).toEqual([]);
  });

  it("refuses a key for a host the sheet doesn't send it to", async () => {
    const { host } = createRecordingHost(modelSheet, withKey, fakeTransport(ok).transport);

    await expect(
      host.http.fetch("https://files.example.com/v1", {
        auth: { secret: "example-key", as: "header", header: "x-api-key" },
      }),
    ).rejects.toMatchObject({ code: "secret-not-allowed-for-host" });
  });

  it("refuses a required key that isn't set", async () => {
    const { host } = createRecordingHost(modelSheet, values({}), fakeTransport(ok).transport);

    await expect(
      host.http.fetch("https://api.example.com/v1", {
        auth: { secret: "example-key", as: "header", header: "x-api-key" },
      }),
    ).rejects.toMatchObject({ code: "secret-not-configured" });
  });

  it("sends no key for an optional secret that isn't set", async () => {
    const service = fakeTransport(ok);
    const { host } = createRecordingHost(
      serverSheet,
      values({}, { url: "https://mcp.example.com/mcp" }),
      service.transport,
    );

    await host.http.fetch("https://mcp.example.com/mcp", {
      auth: { secret: "server-key", as: "bearer" },
    });

    expect(service.sent[0]?.headers.has("authorization")).toBe(false);
  });

  it("calls the host of the URL in a setting, with its key as a bearer token", async () => {
    const service = fakeTransport(ok);
    const { host } = createRecordingHost(
      serverSheet,
      values({ "server-key": FAKE.plainKey }, { url: "https://mcp.example.com:8443/mcp" }),
      service.transport,
    );

    await host.http.fetch("https://mcp.example.com:8443/mcp", {
      auth: { secret: "server-key", as: "bearer" },
    });

    expect(service.sent[0]?.headers.get("authorization")).toBe(`Bearer ${FAKE.plainKey}`);
    await expect(host.http.fetch("https://mcp.example.com/mcp")).rejects.toMatchObject({
      code: "host-not-allowed",
    });
  });

  it("allows plain http only to a server on this machine or a private network", async () => {
    const local = createRecordingHost(
      serverSheet,
      values({}, { url: "http://localhost:8080/mcp" }),
      fakeTransport(ok).transport,
    );
    await expect(local.host.http.fetch("http://localhost:8080/mcp")).resolves.toBeInstanceOf(
      Response,
    );

    expect(() =>
      createRecordingHost(
        serverSheet,
        values({}, { url: "http://mcp.example.com/mcp" }),
        fakeTransport(ok).transport,
      ),
    ).toThrow(HostRefused);
  });

  it("names the setting it can't read, never its value", () => {
    const create = () =>
      createRecordingHost(
        serverSheet,
        values({}, { url: "not a url" }),
        fakeTransport(ok).transport,
      );

    expect(create).toThrow('the setting "url" must be an http or https URL');
    expect(create).not.toThrow("not a url");
  });

  it("follows a redirect to a declared host, without the key the sheet doesn't send there", async () => {
    const service = fakeTransport(redirect("https://files.example.com/download"), ok);
    const { host } = createRecordingHost(modelSheet, withKey, service.transport);

    const response = await host.http.fetch("https://api.example.com/v1/file", {
      headers: { authorization: "Bearer session" },
      auth: { secret: "example-key", as: "header", header: "x-api-key" },
    });

    expect(response.status).toBe(200);
    expect(service.sent.map((request) => request.url)).toEqual([
      "https://api.example.com/v1/file",
      "https://files.example.com/download",
    ]);
    expect(service.sent[1]?.headers.has("x-api-key")).toBe(false);
    expect(service.sent[1]?.headers.has("authorization")).toBe(false);
  });

  it("refuses a redirect to a host that isn't in the sheet", async () => {
    const service = fakeTransport(redirect("https://other.example.com/"));
    const recording = createRecordingHost(modelSheet, withKey, service.transport);

    await expect(recording.host.http.fetch("https://api.example.com/v1")).rejects.toMatchObject({
      code: "host-not-allowed",
    });
    expect(recording.refusals()).toHaveLength(1);
  });

  it("turns a POST into a GET after a 303, as fetch does", async () => {
    const service = fakeTransport(redirect("https://api.example.com/v1/result", 303), ok);
    const { host } = createRecordingHost(modelSheet, withKey, service.transport);

    await host.http.fetch("https://api.example.com/v1/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(service.sent[1]?.method).toBe("GET");
    expect(service.sent[1]?.headers.has("content-type")).toBe(false);
  });

  it("stops after five redirects", async () => {
    const service = fakeTransport(redirect("https://api.example.com/v1/again"));
    const { host } = createRecordingHost(modelSheet, withKey, service.transport);

    await expect(host.http.fetch("https://api.example.com/v1/again")).rejects.toMatchObject({
      code: "too-many-redirects",
    });
    expect(service.sent).toHaveLength(6);
  });

  it("never puts a key in a refusal", async () => {
    const { host } = createRecordingHost(modelSheet, withKey, fakeTransport(ok).transport);

    const error = await host.http
      .fetch(`https://other.example.com/?key=${FAKE.apiKey}`, {
        auth: { secret: "example-key", as: "header", header: "x-api-key" },
      })
      .catch((caught: unknown) => caught);

    expect(String((error as Error).stack)).not.toContain(FAKE.apiKey);
  });

  it("gives the integration its settings and a wait", async () => {
    const { host } = createRecordingHost(
      serverSheet,
      values({}, { url: "https://mcp.example.com/mcp" }),
      fakeTransport(ok).transport,
    );

    expect(host.settings).toEqual({ url: "https://mcp.example.com/mcp" });
    await expect(host.wait(0)).resolves.toBeUndefined();
    await expect(host.wait(10, AbortSignal.abort(new Error("stopped")))).rejects.toThrow("stopped");
  });
});
