import { describe, expect, it } from "vitest";
import { FAKE } from "../test/fakes.ts";
import { encodeBase64 } from "./base64.ts";
import type { CapturedExchange, RecordedExchange } from "./exchange.ts";
import { definePolicy } from "./policy.ts";
import { scrubExchanges } from "./scrubber.ts";

/*
 * `exchange.ts` only holds the shapes of an exchange. These tests check what
 * those shapes promise: a captured request and its response go in together,
 * and the recorded exchange that comes out holds no secret in any header,
 * URL or body, on either side.
 */

/** Every fake secret and piece of personal data the exchanges below carry. */
const SECRETS = [
  FAKE.apiKey,
  FAKE.plainKey,
  FAKE.randomToken,
  FAKE.jwt,
  FAKE.openAiKey,
  FAKE.googleKey,
  FAKE.email,
  FAKE.otherEmail,
  FAKE.phone,
];

/** The forms a value can take in a saved exchange: as is, URL-encoded or base64-encoded. */
function encodings(value: string): string[] {
  return [
    value,
    encodeURIComponent(value),
    encodeBase64(value, { urlSafe: false, padded: false }),
    encodeBase64(value, { urlSafe: true, padded: false }),
  ];
}

function expectNoSecrets(exchanges: readonly RecordedExchange[]): void {
  const saved = JSON.stringify(exchanges);
  for (const secret of SECRETS) {
    for (const form of encodings(secret)) {
      expect(saved).not.toContain(form);
    }
  }
}

function scrub(exchanges: CapturedExchange[]): RecordedExchange[] {
  return scrubExchanges(exchanges, {
    policy: definePolicy({ secretHeaders: ["X-Fake-Tenant"] }),
    knownSecrets: [FAKE.apiKey, FAKE.plainKey],
  }).exchanges;
}

/** An OAuth-style token exchange: secrets in the request and the response, in every part. */
function tokenExchange(): CapturedExchange {
  return {
    request: {
      method: "post",
      url: `https://fakeuser:${FAKE.plainKey}@auth.example.com/v1/token/${FAKE.email}?key=${FAKE.googleKey}&login_hint=${encodeURIComponent(FAKE.email)}#${FAKE.randomToken}`,
      headers: [
        [
          "Authorization",
          `Basic ${encodeBase64(`fakeuser:${FAKE.plainKey}`, { urlSafe: false, padded: true })}`,
        ],
        ["X-Fake-Tenant", FAKE.plainKey],
        ["Cookie", `session=${FAKE.randomToken}`],
        ["Content-Type", "application/x-www-form-urlencoded"],
      ],
      body: new URLSearchParams([
        ["grant_type", "authorization_code"],
        ["code", FAKE.randomToken],
        ["client_secret", FAKE.openAiKey],
        ["note", `call ${FAKE.phone} or mail ${FAKE.otherEmail}`],
      ]).toString(),
    },
    response: {
      status: 302,
      headers: [
        ["Location", `/callback?code=${FAKE.randomToken}&state=${FAKE.jwt}`],
        ["Set-Cookie", `session=${FAKE.randomToken}; HttpOnly`],
        ["Content-Type", "application/json"],
        ["X-Fake-Owner", FAKE.email],
      ],
      body: JSON.stringify({
        access_token: FAKE.jwt,
        refresh_token: FAKE.randomToken,
        owner: { email: FAKE.otherEmail, phone: FAKE.phone },
        echoed: `Bearer ${FAKE.apiKey}`,
      }),
    },
  };
}

/** A streamed model reply that repeats a key from its request. */
function streamExchange(): CapturedExchange {
  return {
    request: {
      method: "POST",
      url: "https://api.example.com/v1/messages",
      headers: [
        ["x-api-key", FAKE.apiKey],
        ["content-type", "application/json"],
      ],
      body: JSON.stringify({ messages: [{ role: "user", content: `my key is ${FAKE.plainKey}` }] }),
    },
    response: {
      status: 200,
      headers: [["content-type", "text/event-stream"]],
      body: [
        "event: delta",
        `data: {"text":"Your key ${FAKE.plainKey} and address ${FAKE.email}"}`,
        "",
        "event: delta",
        `data: {"text":"${encodeBase64(FAKE.openAiKey, { urlSafe: false, padded: true })}"}`,
        "",
        "",
      ].join("\n"),
    },
  };
}

describe("scrubbing a request and its response together", () => {
  it("leaves no secret in any header, URL or body of a form request and JSON response", () => {
    expectNoSecrets(scrub([tokenExchange()]));
  });

  it("leaves no secret in a JSON request and its event stream", () => {
    expectNoSecrets(scrub([streamExchange()]));
  });

  it("keeps the shape of the exchange", () => {
    const [recorded] = scrub([tokenExchange()]);
    expect(recorded?.transport).toBe("http");
    expect(recorded?.request.method).toBe("POST");
    expect(recorded?.request.body.kind).toBe("form");
    expect(recorded?.response.status).toBe(302);
    expect(recorded?.response.body.kind).toBe("json");
    expect(Object.keys(recorded?.response.headers ?? {}).sort()).toEqual([
      "content-type",
      "location",
      "set-cookie",
      "x-fake-owner",
    ]);
  });

  it("gives a value the same stand-in in the request and in the response", () => {
    // The code sent in the request body comes back in the Location header.
    const [recorded] = scrub([tokenExchange()]);
    const requestCode =
      recorded?.request.body.kind === "form"
        ? recorded.request.body.value.find(([name]) => name === "code")?.[1]
        : undefined;
    expect(requestCode).toMatch(/^scrubbed-secret-\d+$/);
    expect(recorded?.response.headers["location"]).toContain(`code=${requestCode}`);
  });

  it("puts the fixed stand-in where the integration's own key was, on both sides", () => {
    const [recorded] = scrub([streamExchange()]);
    expect(recorded?.request.headers["x-api-key"]).toBe("<scrubbed:secret>");
    expect(JSON.stringify(recorded?.response.body)).toContain("Your key <scrubbed:secret>");
  });

  // Known bug (HAL-690): a `Link` header goes through the free-text rules,
  // not the URL rules, so a query parameter with a secret name keeps its value
  // unless it also looks random. The same parameter in the request URL is
  // replaced, and the safety net doesn't catch it either. Fixed separately;
  // turn this back into `it` then.
  it.fails("replaces a secret-named query parameter in a Link header", () => {
    const token = "fake-access-token-1234";
    const [recorded] = scrub([
      {
        request: {
          method: "GET",
          url: `https://api.example.com/v1/items?access_token=${token}`,
          headers: [],
        },
        response: {
          status: 200,
          headers: [
            ["Link", `<https://api.example.com/v1/items?access_token=${token}&page=2>; rel="next"`],
            ["Content-Type", "application/json"],
          ],
          body: "{}",
        },
      },
    ]);
    expect(recorded?.request.url).not.toContain(token);
    expect(recorded?.response.headers["link"]).not.toContain(token);
  });
});
