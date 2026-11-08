import { describe, expect, it } from "vitest";
import { findSecretFields } from "./secret-fields.ts";

/** A recording file with one exchange, as text. */
function recording(request: object, response: object = {}): string {
  const empty = { headers: {}, body: { kind: "empty" } };
  return JSON.stringify({
    exchanges: [
      {
        transport: "http",
        request: { method: "GET", url: "https://api.example.com/", ...empty, ...request },
        response: { status: 200, ...empty, ...response },
      },
    ],
  });
}

describe("findSecretFields", () => {
  it("finds a short value in a header named like a secret", () => {
    const text = recording({ headers: { "x-access-token": "hunter2hunter2" } });
    expect(findSecretFields(text)).toEqual(["exchanges[0].request.headers.x-access-token"]);
  });

  it("finds a query parameter named like a secret, also in a URL header and a nested URL", () => {
    const next = encodeURIComponent("https://login.example.com/?token=fake");
    const text = recording(
      { url: `https://api.example.com/?key=fake&next=${next}` },
      { headers: { location: "/callback?code=fake" } },
    );
    expect(findSecretFields(text)).toEqual([
      "exchanges[0].request.url.query.key",
      "exchanges[0].request.url.query.next.query.token",
      "exchanges[0].response.headers.location.query.code",
    ]);
  });

  it("finds form fields and every string under a secret JSON name", () => {
    const text = recording(
      { body: { kind: "form", value: [["password", "fake"]] } },
      { body: { kind: "json", value: { auth: { secret: ["fake"], expires_in: 3600 } } } },
    );
    expect(findSecretFields(text)).toEqual([
      "exchanges[0].request.body.password",
      "exchanges[0].response.body.auth.secret[0]",
    ]);
  });

  it("finds the authorization code in an OAuth token request sent as JSON, not an error code", () => {
    const tokenRequest = { grant_type: "authorization_code", code: "fake" };
    const text = recording(
      { body: { kind: "json", value: tokenRequest } },
      { body: { kind: "json", value: { error: { code: "invalid_grant" } } } },
    );
    expect(findSecretFields(text)).toEqual(["exchanges[0].request.body.code"]);
  });

  it("looks inside stream event data", () => {
    const events = [{ event: "message", data: { session: { id: "x", token: "fake" } } }];
    const text = recording({}, { body: { kind: "sse", value: events } });
    expect(findSecretFields(text)).toEqual(["exchanges[0].response.body[0].data.session.token"]);
  });

  it("accepts stand-ins, empty values, numbers and ordinary fields", () => {
    const text = recording(
      {
        url: "https://api.example.com/?key=%3Cscrubbed%3Asecret%3E&token=&limit=10",
        headers: { authorization: "Bearer <scrubbed:secret>", "x-csrf-token": "scrubbed-secret-1" },
      },
      {
        headers: { "set-cookie": "<scrubbed:secret>", "content-type": "application/json" },
        body: { kind: "json", value: { access_token: "scrubbed-secret-2", max_tokens: 1024 } },
      },
    );
    expect(findSecretFields(text)).toEqual([]);
  });

  it("doesn't read a name the scrubber replaced as a secret name", () => {
    // A map keyed by a 32-hex ID and a random query name both come out of the
    // scrubber as `scrubbed-secret-N`; their values are ordinary.
    const text = recording(
      {
        url: "https://api.example.com/?scrubbed-secret-1=10",
        body: { kind: "form", value: [["scrubbed-secret-2", "on"]] },
      },
      {
        body: {
          kind: "json",
          value: { items: { "scrubbed-secret-3": { name: "Inbox", unread: 3 } } },
        },
      },
    );
    expect(findSecretFields(text)).toEqual([]);
  });

  it("finds nothing in text that isn't a recording", () => {
    expect(findSecretFields("not json")).toEqual([]);
  });
});
