import { describe, expect, it } from "vitest";
import { runChecks } from "./fixture-repo.ts";

const sheetPath = "integrations/tools/example/mail/integration.yaml";

const googleSecret = `secrets:
  google-account:
    purpose: Access to the Google account you connect, through the Google sign-in.
    hosts: [mail.googleapis.com]
    as: bearer
`;

const scopes = `googleScopes:
  - scope: https://www.googleapis.com/auth/mail.readonly
    reason: Reads your mail so the assistant can answer questions about it.
`;

const apis = `googleApis:
  - api: mail.googleapis.com
    name: Example Mail API
`;

const check = `googleCheck:
  method: GET
  url: https://mail.googleapis.com/mail/v1/users/me/profile
`;

/** A sheet from parts, which tests change one at a time. */
function sheet(...parts: string[]): string {
  return ["id: tool-example-mail", "hosts:\n  - mail.googleapis.com", ...parts, "tokens: []"].join(
    "\n",
  );
}

/** The google-sheet messages for a sheet. */
function messagesFor(text: string): string[] {
  return runChecks([], { extraFiles: { [sheetPath]: text } })
    .filter((problem) => problem.rule === "google-sheet")
    .map((problem) => problem.message);
}

describe("tooling/check: Google fields of the permission sheet", () => {
  it("accepts all three fields with the Google sign-in", () => {
    expect(messagesFor(sheet(googleSecret, scopes, apis, check))).toEqual([]);
  });

  it("accepts flow style, quotes and folded text", () => {
    const flow = `googleScopes:
  - { scope: "https://www.googleapis.com/auth/mail.readonly", reason: 'Reads the user''s mail.' }
googleApis: [{ api: mail.googleapis.com, name: Example Mail API }] # the Console's name
googleCheck: { method: GET, url: https://mail.googleapis.com/mail/v1/users/me/profile }
`;
    const folded = `googleScopes:
  - scope: https://www.googleapis.com/auth/mail.readonly
    reason: >-
      Reads your mail, which doesn't include
      deleting it.
`;
    expect(messagesFor(sheet(googleSecret, flow))).toEqual([]);
    expect(messagesFor(sheet(googleSecret, folded, apis))).toEqual([]);
  });

  it("accepts a sheet without the Google sign-in and without the fields", () => {
    expect(messagesFor(sheet("secrets: {}"))).toEqual([]);
  });

  it("allows the fields only with the google-account secret", () => {
    expect(messagesFor(sheet(scopes, apis, check))).toEqual([
      "googleScopes is only for an integration that uses the google-account secret. Remove it, or add the secret.",
      "googleApis is only for an integration that uses the google-account secret. Remove it, or add the secret.",
      "googleCheck is only for an integration that uses the google-account secret. Remove it, or add the secret.",
    ]);
  });

  it("refuses scopes written as plain text", () => {
    const plain = "googleScopes:\n  - https://www.googleapis.com/auth/mail.readonly\n";
    expect(messagesFor(sheet(googleSecret, plain, apis))).toEqual([
      "googleScopes entry 1 is { scope, reason }, not plain text.",
    ]);
  });

  it("needs a non-empty reason and name", () => {
    const noReason = `googleScopes:
  - scope: https://www.googleapis.com/auth/mail.readonly
    reason: ""
`;
    const noName = "googleApis:\n  - api: mail.googleapis.com\n";
    expect(messagesFor(sheet(googleSecret, noReason, noName))).toEqual([
      "googleScopes entry 1 needs a non-empty reason.",
      "googleApis entry 1 needs a non-empty name.",
    ]);
  });

  it("refuses unknown keys and an api that isn't a service name", () => {
    const odd = `googleApis:
  - api: Example Mail API
    name: Example Mail API
    console: https://console.example.com
`;
    expect(messagesFor(sheet(googleSecret, scopes, odd))).toEqual([
      "googleApis entry 1 has console; an entry holds only { api, name }.",
      "googleApis entry 1: api is the service name the Console uses, such as drive.googleapis.com.",
    ]);
  });

  it("needs googleApis whenever googleScopes is set", () => {
    expect(messagesFor(sheet(googleSecret, scopes))).toEqual([
      "A sheet with googleScopes also lists googleApis: { api, name } for each API the user switches on, such as { api: gmail.googleapis.com, name: Gmail API }.",
    ]);
    expect(messagesFor(sheet(googleSecret, apis))).toEqual([]);
  });

  it("allows googleCheck only as a GET", () => {
    const post = check.replace("GET", "POST");
    expect(messagesFor(sheet(googleSecret, scopes, apis, post))).toEqual([
      "googleCheck uses method GET: it only looks, it changes nothing.",
    ]);
  });

  it("refuses a body and other keys in googleCheck", () => {
    const withBody = `${check}  body: "{}"\n  headers: {}\n`;
    expect(messagesFor(sheet(googleSecret, scopes, apis, withBody))).toEqual([
      "googleCheck sends no body.",
      "googleCheck has headers; it holds only method and url.",
    ]);
  });

  it("sends googleCheck only to a host of the sheet, over https", () => {
    const elsewhere = check.replace("mail.googleapis.com", "www.googleapis.com");
    const plain = check.replace("https:", "http:");
    expect(messagesFor(sheet(googleSecret, scopes, apis, elsewhere))).toEqual([
      "googleCheck goes to www.googleapis.com, which isn't in the sheet's hosts.",
    ]);
    expect(messagesFor(sheet(googleSecret, scopes, apis, plain))).toEqual([
      "googleCheck url uses https.",
    ]);
    expect(
      messagesFor(sheet(googleSecret, scopes, apis, "googleCheck: { method: GET, url: /me }")),
    ).toEqual(["googleCheck needs a full https url."]);
  });

  it("points at the line of YAML it can't read", () => {
    const anchored = "googleApis:\n  - &api mail.googleapis.com\n    name: x\n";
    const problems = runChecks([], {
      extraFiles: { [sheetPath]: sheet(googleSecret, scopes, anchored) },
    });
    expect(problems.map((problem) => [problem.rule, problem.line])).toEqual([["google-sheet", 15]]);
  });
});
