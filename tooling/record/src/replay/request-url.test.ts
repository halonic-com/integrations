import { describe, expect, it } from "vitest";
import { RECORDING_FORMAT, type RecordingFile } from "../format.ts";
import { replay } from "../replay.ts";

const base = "https://api.example.com/v1/users";

/** A recording of one search, scrubbed as the recorder writes it. */
function recordingOf(url: string): RecordingFile {
  return {
    format: RECORDING_FORMAT,
    integration: "example",
    scenario: "search",
    exchanges: [
      {
        transport: "http",
        request: { method: "GET", url, headers: {}, body: { kind: "empty" } },
        response: { status: 200, headers: {}, body: { kind: "json", value: { items: [] } } },
      },
    ],
    scrubReport: [],
  };
}

const searched = recordingOf(`${base}/me/messages?q=%3Cscrubbed%3Acontent%3E&maxResults=10`);

/** What the example integration declares in its `recording` section. */
const policy = { userContent: ["request.query.q"] };

describe("replay of a request URL", () => {
  it("scrubs a declared query parameter, so a real search matches its placeholder", async () => {
    const recorded = replay(searched, { policy });
    const url = `${base}/me/messages?q=${encodeURIComponent("from:someone dentist")}&maxResults=10`;
    await recorded.http.fetch(url);
    expect(recorded.sent.map((request) => request.url)).toEqual([url]);
    recorded.assertAllUsed();
  });

  it("fails a search when the sheet doesn't declare the parameter, and points at the policy", async () => {
    const recorded = replay(searched, { policy: { userContent: [] } });
    await expect(
      recorded.http.fetch(`${base}/me/messages?q=dentist&maxResults=10`),
    ).rejects.toThrow(
      "got GET https://api.example.com/v1/users/me/messages?q=dentist&maxResults=10. If it is the user's own content, pass the integration's recording policy",
    );
  });

  it("still compares the parameters the sheet doesn't declare", async () => {
    const recorded = replay(searched, { policy });
    await expect(
      recorded.http.fetch(`${base}/me/messages?q=dentist&maxResults=20`),
    ).rejects.toThrow("maxResults=20");
  });

  it("scrubs an address in the path, so it matches its stand-in", async () => {
    const recorded = replay(recordingOf(`${base}/person3%40example.com/messages`), { policy });
    await recorded.http.fetch(`${base}/${encodeURIComponent("someone@mail.test")}/messages`);
    recorded.assertAllUsed();
  });

  it("fails a URL the recorder couldn't read", async () => {
    const recorded = replay(searched, { policy });
    await expect(recorded.http.fetch("/me/messages")).rejects.toThrow(
      "The request URL can't be read the way the recorder reads it",
    );
  });
});
