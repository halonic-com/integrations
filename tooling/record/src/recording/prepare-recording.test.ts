import { describe, expect, it } from "vitest";
import { recordingFileSchema } from "../format.ts";
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
    policy: definePolicy({ userContent: ["response.body.messages[*].snippet"] }),
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
      transport: "http",
      request: {
        ...exchange.request,
        headers: Object.fromEntries(exchange.request.headers),
        body: { kind: "empty" },
      },
      response: {
        ...exchange.response,
        headers: Object.fromEntries(exchange.response.headers),
        body: {
          kind: "text",
          contentType: "application/json",
          value: exchange.response.body ?? "",
        },
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
      format: "halonic.recording/1",
      integration: "example-mail",
      scenario: "list-messages",
      exchanges: [
        {
          transport: "http",
          request: {
            method: "GET",
            url: "https://mail.example.com/v1/messages",
            headers: { authorization: "Bearer <scrubbed:secret>" },
            body: { kind: "empty" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              kind: "json",
              value: {
                messages: [
                  { id: "m1", from: "person1@example.com", snippet: "<scrubbed:content>" },
                ],
              },
            },
          },
        },
      ],
      scrubReport: [
        { rule: "secret-header", path: "exchanges[0].request.headers.authorization", count: 1 },
        { rule: "email", path: "exchanges[0].response.body.messages[0].from", count: 1 },
        { rule: "user-content", path: "exchanges[0].response.body.messages[0].snippet", count: 1 },
      ],
    });
  });

  it("writes keys sorted, indented by 2, with a final line break", () => {
    const prepared = prepareRecording(input([listMessages]));
    if (!prepared.ok) {
      throw new Error("expected a clean recording");
    }
    const lines = prepared.text.split("\n");
    expect(lines.slice(0, 2)).toEqual(["{", '  "exchanges": [']);
    expect(
      lines.filter((line) => /^ {2}"/.test(line)).map((line) => line.trim().split('"')[1]),
    ).toEqual(["exchanges", "format", "integration", "scenario", "scrubReport"]);
    expect(prepared.text.endsWith("}\n")).toBe(true);
  });

  it("gives the same text for the same recording", () => {
    const first = prepareRecording(input([listMessages]));
    const second = prepareRecording(input([listMessages]));
    expect(first).toEqual(second);
  });

  it("reads back with the recording schema the conformance suite uses", () => {
    const prepared = prepareRecording(input([listMessages]));
    if (!prepared.ok) {
      throw new Error("expected a clean recording");
    }
    expect(recordingFileSchema.safeParse(JSON.parse(prepared.text)).success).toBe(true);
  });

  it("refuses a file that doesn't match the format, naming only the place", () => {
    const prepared = prepareRecording({ ...input([listMessages]), scenario: "List Messages" });
    expect(prepared).toEqual({
      ok: false,
      reason: "refused",
      where: "scenario",
      message: "the file doesn't match the recording format",
    });
  });

  it("refuses to save when a rule misses a fake key, and the safety net catches it", () => {
    const prepared = prepareRecording(input([listMessages]), scrubNothing);
    expect(prepared.ok).toBe(false);
    if (prepared.ok || prepared.reason !== "leak") {
      throw new Error("expected the safety net to refuse the recording");
    }
    // Four finds: the key three times (as the known value, by its "Bearer"
    // shape and as the value of the authorization header) and the e-mail
    // address in the body.
    expect(prepared.leaks.map((leak) => leak.kind)).toEqual([
      "known-secret",
      "token-shape",
      "email",
      "secret-field",
    ]);
    expect(JSON.stringify(prepared)).not.toContain(FAKE.plainKey);
  });

  it("refuses a declared user-content path that matched nothing", () => {
    const typo = {
      ...input([listMessages]),
      policy: definePolicy({ userContent: ["response.body.mesages[*].snippet"] }),
    };
    expect(prepareRecording(typo)).toMatchObject({
      ok: false,
      reason: "refused",
      where: "recording.userContent",
    });
  });

  it("accepts an unmatched user-content path the scenario lists as unused", () => {
    const sendOnly = definePolicy({
      userContent: ["response.body.messages[*].snippet", "request.body.raw"],
    });
    const prepared = prepareRecording({
      ...input([listMessages]),
      policy: sendOnly,
      unusedUserContent: ["request.body.raw"],
    });
    expect(prepared.ok).toBe(true);
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
        'exchanges[0].response.body: a body with content type "image/png" can\'t be scrubbed. If the integration really needs it, allow it with recording.allowContentTypes',
    });
  });
});
