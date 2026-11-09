import { describe, expect, it } from "vitest";
import { FAKE } from "../test/fakes.ts";
import { knownValues, readRecordValues, secretVariable, settingVariable } from "./record-values.ts";
import { readRecordingSheet } from "./sheet.ts";

const modelSheet = readRecordingSheet(`id: model-example
hosts: [api.example.com]
secrets:
  example-key:
    hosts: [api.example.com]
    as: bearer
`);

const serverSheet = readRecordingSheet(`id: tool-example-server
hosts:
  - fromSetting: url
secrets:
  server-key:
    hosts: [{ fromSetting: url }]
    as: bearer
    optional: true
`);

describe("record values", () => {
  it("names the variables after the sheet's kebab-case names", () => {
    expect(secretVariable("anthropic-key")).toBe("HALONIC_RECORD_SECRET_ANTHROPIC_KEY");
    expect(secretVariable("google-account")).toBe("HALONIC_RECORD_SECRET_GOOGLE_ACCOUNT");
    expect(settingVariable("url")).toBe("HALONIC_RECORD_SETTING_URL");
  });

  it("reads each secret from its variable", () => {
    const read = readRecordValues(modelSheet, { HALONIC_RECORD_SECRET_EXAMPLE_KEY: FAKE.apiKey });

    expect(read).toEqual({
      ok: true,
      values: { secrets: new Map([["example-key", FAKE.apiKey]]), settings: {} },
    });
  });

  it("reports a missing required secret by its variable name only", () => {
    expect(readRecordValues(modelSheet, {})).toEqual({
      ok: false,
      missing: ["HALONIC_RECORD_SECRET_EXAMPLE_KEY"],
    });
    expect(readRecordValues(modelSheet, { HALONIC_RECORD_SECRET_EXAMPLE_KEY: "" })).toEqual({
      ok: false,
      missing: ["HALONIC_RECORD_SECRET_EXAMPLE_KEY"],
    });
  });

  it("leaves out an optional secret that isn't set", () => {
    const read = readRecordValues(serverSheet, {
      HALONIC_RECORD_SETTING_URL: "https://mcp.example.com/mcp",
    });

    expect(read).toEqual({
      ok: true,
      values: { secrets: new Map(), settings: { url: "https://mcp.example.com/mcp" } },
    });
  });

  it("reads a setting a host needs once, and reports it when missing", () => {
    expect(readRecordValues(serverSheet, {})).toEqual({
      ok: false,
      missing: ["HALONIC_RECORD_SETTING_URL"],
    });
  });

  it("gives the keys and the settings as known secrets", () => {
    const read = readRecordValues(serverSheet, {
      HALONIC_RECORD_SECRET_SERVER_KEY: FAKE.plainKey,
      HALONIC_RECORD_SETTING_URL: "https://mcp.example.com/mcp",
    });

    expect(read.ok && knownValues(read.values)).toEqual([
      FAKE.plainKey,
      "https://mcp.example.com/mcp",
    ]);
  });
});
