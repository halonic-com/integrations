import { describe, expect, it } from "vitest";
import { RECORDING_FORMAT, type RecordingFile } from "../format.ts";
import { replay } from "../replay.ts";

const url = "https://api.example.com/v1/events/e1";

type RecordedResponseBody = RecordingFile["exchanges"][number]["response"]["body"];

/** A recording of one call whose response has `body`, scrubbed as the recorder writes it. */
function recordingWith(body: RecordedResponseBody, requestUrl = url): RecordingFile {
  return {
    format: RECORDING_FORMAT,
    integration: "example",
    scenario: "get-event",
    exchanges: [
      {
        transport: "http",
        request: { method: "GET", url: requestUrl, headers: {}, body: { kind: "empty" } },
        response: { status: 200, headers: {}, body },
      },
    ],
    scrubReport: [],
  };
}

const event = recordingWith({
  kind: "json",
  value: {
    id: "e1",
    summary: "<scrubbed:content>",
    attendees: [{ email: "person1@example.com", responseStatus: "accepted" }],
    extended: { "field-1": "<scrubbed:content>", "field-2": 0 },
  },
});

/** What the example integration declares in its `recording` section. */
const policy = { userContent: ["response.body.summary", "response.body.extended"] };

async function fetchOnce(recording: RecordingFile, userContent: readonly string[]): Promise<void> {
  await replay(recording, { policy: { userContent: [...userContent] } }).http.fetch(url);
}

describe("replay of a recorded response", () => {
  it("gives back a response whose user content the policy declares", async () => {
    const recorded = replay(event, { policy });
    const response = await recorded.http.fetch(url);
    expect(await response.json()).toMatchObject({ id: "e1", summary: "<scrubbed:content>" });
  });

  it("fails when the sheet doesn't declare a response path the recording scrubbed", async () => {
    await expect(fetchOnce(event, ["response.body.extended"])).rejects.toThrow(
      "The recorded response has user content at response.body.summary, which the recording policy doesn't declare.",
    );
  });

  it("fails inside a value the sheet no longer declares as a whole", async () => {
    await expect(fetchOnce(event, ["response.body.summary"])).rejects.toThrow(
      "user content at response.body.extended.field-1",
    );
  });

  it("fails when the sheet declares a path the recording didn't scrub", async () => {
    await expect(fetchOnce(event, [...policy.userContent, "response.body.id"])).rejects.toThrow(
      'The recorded response doesn\'t match the recording policy at response.body.id: the policy scrubs "e1" to "<scrubbed:content>".',
    );
  });

  it("accepts the error paths the recorder adds by itself for the service", async () => {
    const error = recordingWith(
      {
        kind: "json",
        value: { error: { code: 404, message: "<scrubbed:content>", status: "NOT_FOUND" } },
      },
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/e1",
    );
    const recorded = replay(error);
    const response = await recorded.http.fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/e1",
    );
    expect(response.status).toBe(200);
  });

  it("finds user content in an event stream, form data and text", async () => {
    const stream = recordingWith({
      kind: "sse",
      value: [{ event: "message", data: { delta: { text: "<scrubbed:content>" } } }],
    });
    await expect(fetchOnce(stream, [])).rejects.toThrow("at response.body[0].data.delta.text,");
    await fetchOnce(stream, ["response.body[*].data.delta.text"]);

    const form = recordingWith({ kind: "form", value: [["note", "<scrubbed:content>"]] });
    await expect(fetchOnce(form, [])).rejects.toThrow("at response.body.note,");
    await fetchOnce(form, ["response.body.note"]);

    const text = recordingWith({
      kind: "text",
      contentType: "text/plain",
      value: "<scrubbed:content>",
    });
    await expect(fetchOnce(text, [])).rejects.toThrow("at response.body,");
    await fetchOnce(text, ["response.body"]);
  });

  it("finds user content inside a string that holds JSON", async () => {
    const toolCall = recordingWith({
      kind: "json",
      value: { arguments: '{"city":"<scrubbed:content>"}' },
    });
    await expect(fetchOnce(toolCall, [])).rejects.toThrow("at response.body.arguments.city,");
    await fetchOnce(toolCall, ["response.body.arguments.*"]);
  });
});
