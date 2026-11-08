import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type MakeError, runTool, type ToolImplementation } from "./kit.ts";

const echoArguments = z.strictObject({
  text: z.string().max(10),
  times: z.int().min(1).default(1),
});

const echoTool = {
  declaration: {
    name: "test_echo",
    description: "Repeats text.",
    parameters: z.toJSONSchema(echoArguments, { io: "input" }),
    risk: "read",
    untrusted: false,
  },
  arguments: echoArguments,
  async run(prefix, args) {
    return { text: `${prefix}${args.text.repeat(args.times)}` };
  },
} satisfies ToolImplementation<string, typeof echoArguments>;

class TestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
const makeError: MakeError = (code, message) => new TestError(code, message);

describe("runTool", () => {
  it("runs the named tool with the parsed arguments and returns its result as JSON", async () => {
    const result = await runTool(
      [echoTool],
      ">",
      { name: "test_echo", args: { text: "ab" } },
      makeError,
    );
    expect(JSON.parse(result)).toEqual({ text: ">ab" });
  });

  it("refuses an unknown tool as not-found and shortens the name it repeats", async () => {
    const call = runTool([echoTool], "", { name: "x".repeat(200), args: {} }, makeError);
    await expect(call).rejects.toMatchObject({
      code: "not-found",
      message: `There is no tool named ${"x".repeat(64)}.`,
    });
  });

  it("names the bad arguments, never their values", async () => {
    const call = runTool(
      [echoTool],
      "",
      { name: "test_echo", args: { text: "a secret sentence", extra: 1 } },
      makeError,
    );
    await expect(call).rejects.toMatchObject({ code: "bad-arguments" });
    await expect(call).rejects.not.toThrow(/secret sentence/);
  });

  it("describes the arguments in input mode, so fields with a default stay optional", () => {
    expect(echoTool.declaration.parameters).toMatchObject({ required: ["text"] });
  });
});
