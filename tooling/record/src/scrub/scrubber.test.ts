import { describe, expect, it } from "vitest";
import { FAKE } from "../test/fakes.ts";
import { RecordingRefused } from "./context.ts";
import type { CapturedExchange } from "./exchange.ts";
import { definePolicy } from "./policy.ts";
import { summarizeReport } from "./report.ts";
import { scrubExchanges } from "./scrubber.ts";

const JSON_HEADERS: [string, string][] = [["content-type", "application/json"]];

/** A mail listing followed by a request for one of the listed messages. */
function mailExchanges(): CapturedExchange[] {
  return [
    {
      request: {
        method: "get",
        url: `https://mail.example.com/v1/users/${FAKE.email}/messages?maxResults=2`,
        headers: [["Authorization", `Bearer ${FAKE.apiKey}`]],
      },
      response: {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          messages: [
            { id: "m1", from: FAKE.otherEmail, subject: "Dinner on Friday?", snippet: "See you" },
          ],
          nextPageToken: "page-two",
        }),
      },
    },
    {
      request: {
        method: "GET",
        url: `https://mail.example.com/v1/users/${FAKE.email}/messages?pageToken=page-two`,
        headers: [["Authorization", `Bearer ${FAKE.apiKey}`]],
      },
      response: { status: 200, headers: JSON_HEADERS, body: '{"messages":[]}' },
    },
  ];
}

const mailPolicy = definePolicy({
  userContent: ["response.body.messages[*].subject", "response.body.messages[*].snippet"],
});

describe("scrubExchanges", () => {
  it("scrubs a whole recording", () => {
    const { exchanges } = scrubExchanges(mailExchanges(), {
      policy: mailPolicy,
      knownSecrets: [FAKE.apiKey],
    });
    expect(exchanges[0]).toEqual({
      transport: "http",
      request: {
        method: "GET",
        url: "https://mail.example.com/v1/users/person1%40example.com/messages?maxResults=2",
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
              {
                id: "m1",
                from: "person2@example.com",
                subject: "<scrubbed:content>",
                snippet: "<scrubbed:content>",
              },
            ],
            nextPageToken: "scrubbed-secret-1",
          },
        },
      },
    });
  });

  it("gives the same value the same stand-in in every exchange", () => {
    const { exchanges } = scrubExchanges(mailExchanges(), { policy: mailPolicy });
    const [first, second] = exchanges;
    // The page token from the first response is the one sent in the second request.
    expect(second?.request.url).toBe(
      "https://mail.example.com/v1/users/person1%40example.com/messages?pageToken=scrubbed-secret-1",
    );
    expect(first?.request.url).toContain("person1%40example.com");
  });

  it("finds a key split across the URL and the body", () => {
    const half = FAKE.plainKey.length / 2;
    const { exchanges } = scrubExchanges(
      [
        {
          request: {
            method: "POST",
            url: `https://api.example.com/v1/items?part=${FAKE.plainKey.slice(0, half)}`,
            headers: JSON_HEADERS,
            body: JSON.stringify({ rest: FAKE.plainKey.slice(half) }),
          },
          response: { status: 204, headers: [] },
        },
      ],
      { policy: definePolicy(), knownSecrets: [FAKE.plainKey] },
    );
    const saved = JSON.stringify(exchanges);
    expect(saved).not.toContain(FAKE.plainKey.slice(0, half));
    expect(saved).not.toContain(FAKE.plainKey.slice(half));
  });

  it("lists declared user-content paths that matched nothing", () => {
    const policy = definePolicy({
      userContent: ["response.body.messages[*].snippet", "response.body.mesages[*].subject"],
    });
    const { report } = scrubExchanges(mailExchanges(), { policy });
    expect(report.unmatchedUserContent).toEqual(["response.body.mesages[*].subject"]);
  });

  it("replaces a declared query parameter of the request URL", () => {
    const search: CapturedExchange = {
      request: {
        method: "GET",
        url: `https://mail.example.com/v1/messages?q=${encodeURIComponent("subject:dinner")}`,
        headers: [],
      },
      response: { status: 200, headers: JSON_HEADERS, body: '{"messages":[]}' },
    };
    const policy = definePolicy({ userContent: ["request.query.q"] });
    const { exchanges, report } = scrubExchanges([search], { policy });
    expect(exchanges[0]?.request.url).toBe(
      "https://mail.example.com/v1/messages?q=%3Cscrubbed%3Acontent%3E",
    );
    expect(report.replacements).toEqual([
      { rule: "user-content", where: "exchanges[0].request.url.query.q" },
    ]);
    expect(report.unmatchedUserContent).toEqual([]);
  });

  it("lists a declared query parameter that no request had", () => {
    const policy = definePolicy({ userContent: [...mailPolicy.userContent, "request.query.q"] });
    const { report } = scrubExchanges(mailExchanges(), { policy });
    expect(report.unmatchedUserContent).toEqual(["request.query.q"]);
  });

  it("refuses the whole recording when one body can't be parsed", () => {
    const exchanges = mailExchanges();
    const htmlPage: CapturedExchange = {
      request: { method: "GET", url: "https://mail.example.com/", headers: [] },
      response: { status: 200, headers: [["content-type", "text/html"]], body: "<p>hi</p>" },
    };
    expect(() => scrubExchanges([...exchanges, htmlPage], { policy: mailPolicy })).toThrow(
      new RecordingRefused(
        "exchanges[2].response.body",
        'a body with content type "text/html" can\'t be scrubbed. If the integration really needs it, allow it with recording.allowContentTypes',
      ),
    );
  });

  it("never puts a removed value in the report", () => {
    const { report } = scrubExchanges(mailExchanges(), {
      policy: mailPolicy,
      knownSecrets: [FAKE.apiKey],
    });
    const printed = JSON.stringify(report) + summarizeReport(report).join("\n");
    for (const value of [FAKE.apiKey, FAKE.email, FAKE.otherEmail, "Dinner", "page-two"]) {
      expect(printed).not.toContain(value);
    }
    expect(summarizeReport(report)).toEqual([
      "3 e-mail addresses",
      "2 secret headers",
      "2 user-content fields",
      "2 secret fields",
    ]);
  });

  describe("never gives a real value the stand-in of an example value it keeps", () => {
    /** One exchange whose response body is `text`, as plain JSON. */
    function exchangeWith(text: string): CapturedExchange {
      return {
        request: { method: "GET", url: "https://mail.example.com/v1/me", headers: [] },
        response: { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ text }) },
      };
    }

    function scrubbedTexts(texts: string[]): unknown[] {
      const { exchanges } = scrubExchanges(texts.map(exchangeWith), { policy: mailPolicy });
      return exchanges.map(({ response }) =>
        response.body.kind === "json" ? response.body.value : undefined,
      );
    }

    it("when the example address comes first", () => {
      expect(scrubbedTexts(["person1@example.com", FAKE.email])).toEqual([
        { text: "person1@example.com" },
        { text: "person2@example.com" },
      ]);
    });

    it("when the example address comes after the real one", () => {
      expect(scrubbedTexts([FAKE.email, "Person1@example.com"])).toEqual([
        { text: "person2@example.com" },
        { text: "Person1@example.com" },
      ]);
    });

    it("for a drama number after a real one", () => {
      expect(scrubbedTexts([`call ${FAKE.phone}`, "call +44 7700 900001"])).toEqual([
        { text: "call +447700900002" },
        { text: "call +44 7700 900001" },
      ]);
    });
  });

  it("doesn't change the captured exchanges", () => {
    const captured = mailExchanges();
    const copy = structuredClone(captured);
    scrubExchanges(captured, { policy: mailPolicy });
    expect(captured).toEqual(copy);
  });
});
