import { describe, expect, it } from "vitest";
import { GeminiError, gemini } from "./index.ts";
import { hostFor } from "./test/host.ts";

/** A host whose network fails the test: connecting must send no request. */
const host = hostFor({
  fetch: async () => {
    throw new Error("connect sent a request");
  },
});

describe("model-gemini", () => {
  it("is named as its permission sheet says, and offers no tools", () => {
    expect(gemini.name).toBe("model-gemini");
    expect(gemini.version).toBe("0.1.0");
    expect(gemini.tools).toEqual([]);
  });

  it("refuses a tool call, because it has no tools", async () => {
    const connection = gemini.connect(host);
    const call = connection.callTool("gemini_anything", {});
    await expect(call).rejects.toBeInstanceOf(GeminiError);
    await expect(call).rejects.toMatchObject({ code: "not-found" });
  });
});
