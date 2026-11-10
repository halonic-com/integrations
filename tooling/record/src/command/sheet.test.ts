import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRecordingSheet, SheetError } from "./sheet.ts";

const modelSheet = `id: model-example
version: 0.1.0
kit: 1

hosts:
  - api.example.com

secrets:
  example-key:
    purpose: Your key. Sent with every call.
    hosts: [api.example.com]
    as: header
    header: x-api-key

tools: []

recording:
  userContent:
    - request.body.messages[*].text # what the user wrote
    - response.body.text
  streamedJson: [response.body[*].data.delta.partial_json]
`;

const serverSheet = `id: tool-example-server
hosts:
  - fromSetting: url
    class: public
secrets:
  server-key:
    purpose: >-
      The key for the server you choose, if it needs one.
    hosts:
      - fromSetting: url
    as: bearer
    optional: true
`;

describe("readRecordingSheet", () => {
  it("reads the hosts, the secrets and the recording section", () => {
    const sheet = readRecordingSheet(modelSheet);

    expect(sheet.id).toBe("model-example");
    expect(sheet.hosts).toEqual(["api.example.com"]);
    expect(sheet.secrets).toEqual({
      "example-key": {
        hosts: ["api.example.com"],
        optional: false,
        placement: { as: "header", header: "x-api-key" },
      },
    });
    expect(sheet.policy.userContent).toEqual([
      "request.body.messages[*].text",
      "response.body.text",
    ]);
    expect(sheet.policy.streamedJson).toEqual(["response.body[*].data.delta.partial_json"]);
  });

  it("adds each secret header to the scrub policy, so it isn't listed twice", () => {
    expect(readRecordingSheet(modelSheet).policy.secretHeaders).toEqual(["x-api-key"]);
  });

  it("reads hosts from a setting and optional bearer secrets", () => {
    const sheet = readRecordingSheet(serverSheet);

    expect(sheet.hosts).toEqual([{ fromSetting: "url", class: "public" }]);
    expect(sheet.secrets["server-key"]).toEqual({
      hosts: [{ fromSetting: "url" }],
      optional: true,
      placement: { as: "bearer" },
    });
    expect(sheet.policy).toEqual({
      secretHeaders: [],
      secretFields: [],
      userContent: [],
      streamedJson: [],
      allowContentTypes: [],
    });
  });

  it.each(["loopback", "private", "public"])("reads the class %s", (addressClass) => {
    const text = serverSheet.replace("class: public", `class: ${addressClass}`);
    expect(readRecordingSheet(text).hosts).toEqual([{ fromSetting: "url", class: addressClass }]);
  });

  it("refuses a { fromSetting } host without a class, as the kit does", () => {
    const text = serverSheet.replace("\n    class: public", "");
    expect(() => readRecordingSheet(text)).toThrow('"hosts.0" is missing or not what');
  });

  it("refuses a class the kit doesn't know", () => {
    const text = serverSheet.replace("class: public", "class: anywhere");
    expect(() => readRecordingSheet(text)).toThrow('"hosts.0" is missing or not what');
  });

  it("refuses a class on a secret's host: it stays with the one in hosts", () => {
    const text = serverSheet.replace(
      "      - fromSetting: url\n    as:",
      "      - fromSetting: url\n        class: public\n    as:",
    );
    expect(() => readRecordingSheet(text)).toThrow('"secrets.server-key.hosts.0" is missing');
  });

  it("refuses a secret that goes to a setting hosts doesn't list", () => {
    const text = serverSheet.replace(
      "      - fromSetting: url\n    as:",
      "      - fromSetting: other\n    as:",
    );
    expect(() => readRecordingSheet(text)).toThrow(
      'the secret "server-key" goes to the setting "other", which "hosts" doesn\'t list',
    );
  });

  it("keeps a header prefix, with the space the quotes keep", () => {
    const sheet = readRecordingSheet(
      modelSheet.replace("header: x-api-key", 'header: x-api-key\n    prefix: "Key "'),
    );
    expect(sheet.secrets["example-key"]?.placement).toEqual({
      as: "header",
      header: "x-api-key",
      prefix: "Key ",
    });
  });

  it("reads a sheet without secrets", () => {
    expect(readRecordingSheet("id: tool-x\nhosts: [a.example.com]\nsecrets:\n").secrets).toEqual(
      {},
    );
    expect(readRecordingSheet("id: tool-x\nhosts: [a.example.com]\n").secrets).toEqual({});
  });

  it.each([
    ["form", "as: form\n    field: api_key"],
    ["query", "as: query"],
  ])("refuses a secret placed as %s rather than guess", (_as, placement) => {
    const text = modelSheet.replace("as: header\n    header: x-api-key", placement);
    expect(() => readRecordingSheet(text)).toThrow(SheetError);
    expect(() => readRecordingSheet(text)).toThrow(/"example-key" goes "as: \w+"/);
  });

  it("refuses a header secret without a header name", () => {
    const text = modelSheet.replace("\n    header: x-api-key", "");
    expect(() => readRecordingSheet(text)).toThrow(
      '"example-key" goes in a header, but names none',
    );
  });

  it("refuses a misspelt key in the recording section, which would remove nothing", () => {
    const text = modelSheet.replace("  userContent:", "  userContents:");
    expect(() => readRecordingSheet(text)).toThrow('"recording" is missing or not what');
  });

  it("refuses a sheet without hosts", () => {
    expect(() => readRecordingSheet("id: tool-x\n")).toThrow('"hosts" is missing');
  });

  it("names the line of YAML it can't read", () => {
    expect(() => readRecordingSheet('id: tool-x\n"hosts": []\n')).toThrow(
      /^integration\.yaml, line 2: /,
    );
  });

  it("reads every sheet in the repo", () => {
    const root = new URL("../../../../", import.meta.url);
    const sheets = globSync("integrations/**/integration.yaml", {
      cwd: root,
      exclude: (name) => name === "node_modules",
    });

    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      expect(() => readRecordingSheet(readFileSync(new URL(sheet, root), "utf8"))).not.toThrow();
    }
  });
});
