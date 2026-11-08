import { describe, expect, it } from "vitest";
import type { CapturedExchange, RecordedExchange } from "../scrub/exchange.ts";
import { definePolicy } from "../scrub/policy.ts";
import type { scrubExchanges } from "../scrub/scrubber.ts";
import { FAKE } from "../test/fakes.ts";
import { prepareRecording, type RecordingInput } from "./prepare-recording.ts";

function input(exchanges: CapturedExchange[]): RecordingInput {
  return {
    integration: "example-mail",
    scenario: "list-messages",
    exchanges,
    policy: definePolicy({ userContent: { response: ["messages[].snippet"] } }),
    knownSecrets: [FAKE.plainKey],
  };
}

const listMessages: CapturedExchange = {
  request: {
    method: "GET",
    url: "https://mail.example.com/v1/messages",
    headers: [["authorization", `Bearer ${FAKE.plainKey}`]],
  },
  response: {
    status: 200,
    headers: [["content-type", "application/json"]],
    body: JSON.stringify({ messages: [{ id: "m1", from: FAKE.email, snippet: "Hi" }] }),
  },
};

/** A broken scrubber: copies everything through unchanged, as if every rule missed. */
const scrubNothing: typeof scrubExchanges = (exchanges) => ({
  exchanges: exchanges.map(
    (exchange): RecordedExchange => ({
      request: {
        ...exchange.request,
        headers: [...exchange.request.headers],
        body: { type: "empty" },
      },
      response: {
        ...exchange.response,
        headers: [...exchange.response.headers],
        body: { type: "text", contentType: "application/json", text: exchange.response.body ?? "" },
      },
    }),
  ),
  report: { replacements: [], unmatchedUserContent: [] },
});

describe("prepareRecording", () => {
  it("returns the file text when the recording is clean", () => {
    const prepared = prepareRecording(input([listMessages]));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(JSON.parse(prepared.text)).toEqual({
      format: "halonic-recording/1",
      integration: "example-mail",
      scenario: "list-messages",
      exchanges: [
        {
          request: {
            method: "GET",
            url: "https://mail.example.com/v1/messages",
            headers: [["authorization", "Bearer scrubbed-secret-1"]],
            body: { type: "empty" },
          },
          response: {
            status: 200,
            headers: [["content-type", "application/json"]],
            body: {
              type: "json",
              value: {
                messages: [
                  { id: "m1", from: "person-1@example.com", snippet: "scrubbed user content" },
                ],
              },
            },
          },
        },
      ],
    });
    expect(prepared.text.endsWith("}\n")).toBe(true);
  });

  it("refuses to save when a rule misses a fake key, and the safety net catches it", () => {
    const prepared = prepareRecording(input([listMessages]), scrubNothing);
    expect(prepared.ok).toBe(false);
    if (prepared.ok || prepared.reason !== "leak") {
      throw new Error("expected the safety net to refuse the recording");
    }
    // The key is found twice: as the known value and by its "Bearer" shape.
    expect(prepared.leaks.map((leak) => leak.kind)).toEqual([
      "known-secret",
      "token-shape",
      "email",
    ]);
    expect(JSON.stringify(prepared)).not.toContain(FAKE.plainKey);
  });

  it("refuses to save when the scrubber refuses", () => {
    const binary: CapturedExchange = {
      request: { method: "GET", url: "https://files.example.com/f/1", headers: [] },
      response: { status: 200, headers: [["content-type", "image/png"]], body: "PNG..." },
    };
    expect(prepareRecording(input([binary]))).toEqual({
      ok: false,
      reason: "refused",
      where: "exchanges[0].response.body",
      message:
        'exchanges[0].response.body: a body with content type "image/png" can\'t be scrubbed. If the integration really needs it, allow it with textContentTypes',
    });
  });
});
