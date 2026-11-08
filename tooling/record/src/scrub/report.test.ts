import { describe, expect, it } from "vitest";
import { FAKE } from "../test/fakes.ts";
import type { CapturedExchange } from "./exchange.ts";
import { definePolicy } from "./policy.ts";
import {
  ReportBuilder,
  reportEntries,
  type ScrubReport,
  type ScrubRule,
  summarizeReport,
} from "./report.ts";
import { scrubExchanges } from "./scrubber.ts";

function reportOf(replacements: [ScrubRule, string][]): ScrubReport {
  const builder = new ReportBuilder();
  for (const [rule, where] of replacements) {
    builder.add(rule, where);
  }
  return builder.build([]);
}

describe("ReportBuilder", () => {
  it("keeps replacements in the order they were made", () => {
    const builder = new ReportBuilder();
    builder.add("email", "exchanges[0].response.body.from");
    builder.add("secret-header", "exchanges[0].request.headers.authorization");
    expect(builder.build(["response.body.typo"])).toEqual({
      replacements: [
        { rule: "email", where: "exchanges[0].response.body.from" },
        { rule: "secret-header", where: "exchanges[0].request.headers.authorization" },
      ],
      unmatchedUserContent: ["response.body.typo"],
    });
  });

  it("doesn't change a report it already built", () => {
    const builder = new ReportBuilder();
    builder.add("email", "exchanges[0].response.body.from");
    const first = builder.build([]);
    builder.add("phone", "exchanges[0].response.body.phone");
    expect(first.replacements).toHaveLength(1);
  });
});

describe("summarizeReport", () => {
  it("has no lines for an empty report", () => {
    expect(summarizeReport(reportOf([]))).toEqual([]);
  });

  it("counts replacements per rule, in the order each rule was first used", () => {
    const report = reportOf([
      ["email", "exchanges[0].response.body.from"],
      ["secret-header", "exchanges[0].request.headers.authorization"],
      ["email", "exchanges[0].response.body.to[0]"],
      ["email", "exchanges[1].response.body.from"],
    ]);
    expect(summarizeReport(report)).toEqual(["3 e-mail addresses", "1 secret headers"]);
  });

  it("has a label for every rule", () => {
    const rules: ScrubRule[] = [
      "secret-header",
      "secret-field",
      "url-userinfo",
      "known-secret",
      "token-shape",
      "random-token",
      "email",
      "phone",
      "user-content",
    ];
    const lines = summarizeReport(reportOf(rules.map((rule) => [rule, "exchanges[0]"])));
    expect(lines).toEqual([
      "1 secret headers",
      "1 secret fields",
      "1 URL user names or passwords",
      "1 known keys",
      "1 token-shaped values",
      "1 random-looking values",
      "1 e-mail addresses",
      "1 phone numbers",
      "1 user-content fields",
    ]);
  });
});

describe("reportEntries", () => {
  it("groups replacements by rule and place, in the order they were first made", () => {
    const report = reportOf([
      ["email", "exchanges[0].response.body.from"],
      ["secret-header", "exchanges[0].request.headers.authorization"],
      ["email", "exchanges[0].response.body.from"],
      // The same place under another rule is its own entry.
      ["phone", "exchanges[0].response.body.from"],
    ]);
    expect(reportEntries(report)).toEqual([
      { rule: "email", path: "exchanges[0].response.body.from", count: 2 },
      { rule: "secret-header", path: "exchanges[0].request.headers.authorization", count: 1 },
      { rule: "phone", path: "exchanges[0].response.body.from", count: 1 },
    ]);
  });

  it("has no entries for an empty report", () => {
    expect(reportEntries(reportOf([]))).toEqual([]);
  });
});

describe("the report of a real scrub", () => {
  /**
   * Fake secrets and personal data in every place the rules look, including
   * the places whose names end up in a report path: JSON field names, form
   * field names and query parameter names.
   */
  function leakyExchanges(): CapturedExchange[] {
    return [
      {
        request: {
          method: "GET",
          url: `https://fakeuser:${FAKE.plainKey}@api.example.com/v1/people/${FAKE.email}?access_token=${FAKE.randomToken}&${FAKE.otherEmail}=1`,
          headers: [
            ["Authorization", `Bearer ${FAKE.apiKey}`],
            ["X-Fake-Note", `call ${FAKE.phone}`],
          ],
        },
        response: {
          status: 200,
          headers: [["content-type", "application/json"]],
          body: JSON.stringify({
            [FAKE.email]: { phone: FAKE.phone, key: FAKE.openAiKey },
            [FAKE.plainKey]: "fake",
            jwt: FAKE.jwt,
            googleKey: FAKE.googleKey,
            snippet: "Fake private snippet",
          }),
        },
      },
      {
        request: {
          method: "POST",
          url: "https://api.example.com/v1/forms",
          headers: [["content-type", "application/x-www-form-urlencoded"]],
          body: new URLSearchParams([
            [FAKE.otherEmail, "yes"],
            ["password", FAKE.plainKey],
          ]).toString(),
        },
        response: { status: 204, headers: [] },
      },
    ];
  }

  const values = [
    FAKE.plainKey,
    FAKE.apiKey,
    FAKE.randomToken,
    FAKE.jwt,
    FAKE.openAiKey,
    FAKE.googleKey,
    FAKE.email,
    FAKE.otherEmail,
    FAKE.phone,
    FAKE.phone.replace(/\D/g, ""),
    "Fake private snippet",
  ];

  function scrubLeaky() {
    return scrubExchanges(leakyExchanges(), {
      policy: definePolicy({ userContent: ["response.body.snippet"] }),
      knownSecrets: [FAKE.apiKey, FAKE.plainKey],
    });
  }

  it("never holds a removed value, in any form it is printed or saved", () => {
    const { report } = scrubLeaky();
    const printed = [
      JSON.stringify(report),
      JSON.stringify(reportEntries(report)),
      summarizeReport(report).join("\n"),
    ].join("\n");
    for (const value of values) {
      expect(printed).not.toContain(value);
      expect(printed).not.toContain(encodeURIComponent(value));
    }
  });

  it("names every rule that removed something", () => {
    const { report } = scrubLeaky();
    const rules = new Set(report.replacements.map((replacement) => replacement.rule));
    expect([...rules].sort()).toEqual([
      "email",
      "known-secret",
      "phone",
      "secret-field",
      "secret-header",
      "token-shape",
      "url-userinfo",
      "user-content",
    ]);
  });
});
