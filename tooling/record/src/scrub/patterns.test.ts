import { describe, expect, it } from "vitest";
import { looksRandom } from "./patterns.ts";

describe("looksRandom", () => {
  it.each([
    ["mixed-case token", "FAKE0aB1cD2eF3gH4iJ5kL6mN7oP8qR9"],
    ["base64 with slashes", "FAKEa1B2/c3D4e5F6+g7H8i9J0kL1m=="],
    ["long hex", "0123456789abcdef0123456789abcdef"],
    ["hex at the end of a path", "v1/sessions/0123456789abcdef0123456789abcdef"],
    ["lower-case token with digits", "fake9x8c7v6b5n4m3k2j1h0g9f8d"],
  ])("finds a %s", (_label, value) => {
    expect(looksRandom(value)).toBe(true);
  });

  it.each([
    ["lower-case API path", "/gmail/v1/users/me/messages"],
    ["camelCase identifier", "thisIsAVeryLongIdentifierName"],
    ["snake_case name", "application_credentials_manager_v2"],
    ["short ID", "18c2f3a1b2c3d4e5"],
    ["MIME type", "vnd.google-apps.folder"],
    ["UUID", "123e4567-e89b-12d3-a456-426614174000"],
  ])("keeps a %s", (_label, value) => {
    expect(looksRandom(value)).toBe(false);
  });
});
