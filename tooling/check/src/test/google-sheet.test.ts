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

  it("accepts restricted: true on a scope and nothing else", () => {
    const restricted = `${scopes}    restricted: true\n`;
    const flow = `googleScopes:
  - { scope: openid, reason: Tells Halonic which account you connected., restricted: true }
`;
    expect(messagesFor(sheet(googleSecret, restricted, apis))).toEqual([]);
    expect(messagesFor(sheet(googleSecret, flow, apis))).toEqual([]);

    const message =
      "googleScopes entry 1: restricted is true, for a scope Google calls restricted. Leave it out otherwise.";
    for (const value of ["false", "yes", "ture", '""']) {
      const odd = `${scopes}    restricted: ${value}\n`;
      expect(messagesFor(sheet(googleSecret, odd, apis)), value).toEqual([message]);
    }
    const onApi = apis.replace(
      "name: Example Mail API",
      "name: Example Mail API\n    restricted: true",
    );
    expect(messagesFor(sheet(googleSecret, scopes, onApi))).toEqual([
      "googleApis entry 1 has restricted; an entry holds only { api, name }.",
    ]);
  });

  it("names the optional key when a scope has an unknown one", () => {
    const odd = `${scopes}    sensitive: true\n`;
    expect(messagesFor(sheet(googleSecret, odd, apis))).toEqual([
      "googleScopes entry 1 has sensitive; an entry holds only { scope, reason } and optionally restricted.",
    ]);
  });

  it("needs googleApis whenever googleScopes is set", () => {
    expect(messagesFor(sheet(googleSecret, scopes))).toEqual([
      "A sheet with googleScopes also lists googleApis: { api, name } for each API the user switches on, such as { api: gmail.googleapis.com, name: Gmail API }.",
    ]);
    expect(messagesFor(sheet(googleSecret, apis))).toEqual([]);
  });

  it("needs at least one googleApis entry with googleScopes", () => {
    expect(messagesFor(sheet(googleSecret, scopes, "googleApis: []"))).toEqual([
      "A sheet with googleScopes also lists googleApis: { api, name } for each API the user switches on, such as { api: gmail.googleapis.com, name: Gmail API }.",
    ]);
  });

  it("needs a Google scope URL or a bare sign-in scope", () => {
    const short = scopes.replace("https://www.googleapis.com/auth/mail.readonly", "mail");
    const elsewhere = scopes.replace("www.googleapis.com", "auth.example.com");
    const signIn = `googleScopes:
  - { scope: openid, reason: Tells Halonic which Google account you connected. }
`;
    const message =
      "googleScopes entry 1: scope is a full Google scope URL, such as https://www.googleapis.com/auth/drive, or openid, email or profile.";
    expect(messagesFor(sheet(googleSecret, short, apis))).toEqual([message]);
    expect(messagesFor(sheet(googleSecret, elsewhere, apis))).toEqual([message]);
    expect(messagesFor(sheet(googleSecret, signIn, apis))).toEqual([]);
  });

  it("can't be skipped with a quoted or spaced top-level key", () => {
    const quoted = check.replace("googleCheck:", '"googleCheck":').replace("GET", "POST");
    const spaced = check.replace("googleCheck:", "googleCheck :").replace("GET", "POST");
    const message =
      'Write this top-level line as a plain "key: value", without quotes or spaces before the colon. This check reads a small part of YAML.';
    expect(messagesFor(sheet(googleSecret, scopes, apis, quoted))).toEqual([message]);
    expect(messagesFor(sheet(googleSecret, scopes, apis, spaced))).toEqual([message]);
    expect(messagesFor(sheet(scopes.replace("googleScopes:", "'googleScopes':")))).toEqual([
      message,
    ]);
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
      "googleCheck carries the google-account token, so www.googleapis.com must be in that secret's hosts too.",
    ]);
    expect(messagesFor(sheet(googleSecret, scopes, apis, plain))).toEqual([
      "googleCheck url uses https.",
    ]);
    expect(
      messagesFor(sheet(googleSecret, scopes, apis, "googleCheck: { method: GET, url: /me }")),
    ).toEqual(["googleCheck needs a full https url."]);
  });

  it("refuses a port, a user name and a fragment in the googleCheck url", () => {
    const message = "googleCheck url has no port, user name, password or #fragment.";
    for (const odd of [
      "https://mail.googleapis.com:8443/mail/v1/users/me/profile",
      "https://user@mail.googleapis.com/mail/v1/users/me/profile",
      "https://mail.googleapis.com/mail/v1/users/me/profile#top",
    ]) {
      const oddCheck = `googleCheck: { method: GET, url: "${odd}" }`;
      expect(messagesFor(sheet(googleSecret, scopes, apis, oddCheck))).toEqual([message]);
    }
  });

  it("sends googleCheck only to a host of the google-account secret", () => {
    const otherSecret = googleSecret.replace("[mail.googleapis.com]", "[upload.googleapis.com]");
    expect(messagesFor(sheet(otherSecret, scopes, apis, check))).toEqual([
      "googleCheck carries the google-account token, so mail.googleapis.com must be in that secret's hosts too.",
    ]);
  });

  it("points at the line of YAML it can't read", () => {
    const anchored = "googleApis:\n  - &api mail.googleapis.com\n    name: x\n";
    const problems = runChecks([], {
      extraFiles: { [sheetPath]: sheet(googleSecret, scopes, anchored) },
    });
    expect(problems.map((problem) => [problem.rule, problem.line])).toEqual([["google-sheet", 15]]);
  });
});
