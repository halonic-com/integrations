import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordingFileSchema } from "../format.ts";
import type { HttpTransport } from "../recording/recording-transport.ts";
import { FAKE } from "../test/fakes.ts";
import { HIDDEN } from "./hide-values.ts";
import { type RecordCommandIo, runRecordCommand } from "./record-command.ts";

const sheet = `id: model-example
hosts:
  - api.example.com
secrets:
  example-key:
    hosts: [api.example.com]
    as: header
    header: x-api-key
recording:
  userContent:
    - request.body.text
    - response.body.text
`;

/**
 * A self-contained integration with three scenarios. It imports nothing, so
 * the test can write it anywhere.
 */
const scenariosFile = `
const integration = {
  connect(host) {
    const ask = async (url, text) => {
      const response = await host.http.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        auth: { secret: "example-key", as: "header", header: "x-api-key" },
      });
      if (!response.ok) throw new Error("the service said " + (await response.text()));
      return response.json();
    };
    return { ask, close: async () => {} };
  },
};

export { integration };
export const scenarios = [
  { name: "answer-text", run: (connection) => connection.ask("https://api.example.com/v1/answer", "Hello") },
  { name: "key-refused", run: (connection) => connection.ask("https://api.example.com/v1/refuse", "Hello") },
  {
    name: "other-host",
    async run(connection) {
      // Caught here, but the run still fails: the sheet doesn't allow this host.
      await connection.ask("https://other.example.com/v1", "Hello").catch(() => {});
    },
  },
];
`;

/** The service: answers with the text it got, or, on /refuse, quotes the key back, as some services do. */
const network: HttpTransport = {
  async fetch(url, init) {
    const key = new Headers(init?.headers).get("x-api-key");
    if (url.endsWith("/refuse")) {
      return new Response(`invalid key ${key}`, { status: 401 });
    }
    return new Response(JSON.stringify({ text: "Hi from the model" }), {
      headers: { "content-type": "application/json" },
    });
  },
};

let root: string;
let folder: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "record-command-"));
  folder = join(root, "integrations", "models", "example");
  mkdirSync(join(folder, "recordings"), { recursive: true });
  writeFileSync(join(folder, "integration.yaml"), sheet);
  writeFileSync(join(folder, "recordings", "scenarios.ts"), scenariosFile);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function run(args: string[], environment: Record<string, string> = {}) {
  const lines: string[] = [];
  const io: RecordCommandIo = {
    root,
    args,
    environment: { HALONIC_RECORD_SECRET_EXAMPLE_KEY: FAKE.plainKey, ...environment },
    network,
    print: (line) => lines.push(line),
  };
  const code = await runRecordCommand(io);
  return { code, output: lines.join("\n") };
}

const recordingFile = (name: string) => join(folder, "recordings", `${name}.json`);

describe("pnpm record", () => {
  it("records a scenario by sheet id, scrubbed, and saves it under its name", async () => {
    const { code, output } = await run(["model-example", "answer-text"]);

    expect(code).toBe(0);
    expect(output).toContain("integrations/models/example/recordings/answer-text.json");
    const text = readFileSync(recordingFile("answer-text"), "utf8");
    const file = recordingFileSchema.parse(JSON.parse(text));
    expect(file).toMatchObject({ integration: "model-example", scenario: "answer-text" });
    expect(text).not.toContain(FAKE.plainKey);
    expect(text).not.toContain("Hi from the model");
  });

  it("finds the integration by its path too", async () => {
    const { code } = await run(["integrations/models/example", "answer-text"]);
    expect(code).toBe(0);
    expect(existsSync(recordingFile("answer-text"))).toBe(true);
  });

  it("never shows the key when a scenario fails, and saves nothing", async () => {
    const { code, output } = await run(["model-example", "answer-text", "key-refused"]);

    expect(code).toBe(1);
    expect(output).toContain("✗ key-refused: the scenario failed:");
    expect(output).toContain(`invalid key ${HIDDEN}`);
    expect(output).not.toContain(FAKE.plainKey);
    expect(output).toContain("Nothing was saved.");
    expect(existsSync(recordingFile("answer-text"))).toBe(false);
  });

  it("shows the scenario's own error when closing the connection fails too", async () => {
    writeFileSync(
      join(folder, "recordings", "scenarios.ts"),
      scenariosFile.replace(
        "close: async () => {}",
        'close: async () => { throw new Error("closing broke"); }',
      ),
    );

    const { code, output } = await run(["model-example", "key-refused"]);

    expect(code).toBe(1);
    expect(output).toContain(`invalid key ${HIDDEN}`);
    expect(output).not.toContain("closing broke");
  });

  it("fails a scenario that asked for a host outside the sheet, even when it caught the refusal", async () => {
    const { code, output } = await run(["model-example", "other-host"]);

    expect(code).toBe(1);
    expect(output).toContain("other.example.com is not one of the hosts in its permission sheet");
    expect(existsSync(recordingFile("other-host"))).toBe(false);
  });

  it("stops before sending anything when a key isn't set, naming only the variable", async () => {
    let sent = 0;
    const lines: string[] = [];
    const code = await runRecordCommand({
      root,
      args: ["model-example"],
      environment: {},
      network: {
        fetch: async () => {
          sent += 1;
          return new Response();
        },
      },
      print: (line) => lines.push(line),
    });

    expect(code).toBe(1);
    expect(sent).toBe(0);
    expect(lines).toEqual([
      "Set these environment variables first: HALONIC_RECORD_SECRET_EXAMPLE_KEY",
    ]);
  });

  it("names the scenarios there are when asked for one that isn't", async () => {
    const { code, output } = await run(["model-example", "no-such-thing"]);

    expect(code).toBe(1);
    expect(output).toBe(
      "No scenario named no-such-thing. model-example has: answer-text, key-refused, other-host",
    );
  });

  it("doesn't take a bare folder name, which is ambiguous between groups", async () => {
    const { code, output } = await run(["example"]);

    expect(code).toBe(1);
    expect(output).toBe('No integration has the sheet id or path "example".');
  });

  it("refuses a scenario name that isn't kebab-case, since it becomes the file name", async () => {
    writeFileSync(
      join(folder, "recordings", "scenarios.ts"),
      scenariosFile.replace('name: "answer-text"', 'name: "../answer"'),
    );

    const { code, output } = await run(["model-example"]);

    expect(code).toBe(1);
    expect(output).toContain("every scenario needs a kebab-case `name`");
  });

  it("shows how to call it without arguments", async () => {
    expect(await run([])).toEqual({
      code: 2,
      output: "Usage: pnpm record <sheet id or path> [scenario...]",
    });
  });
});
