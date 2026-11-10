import { McpError } from "@halonicjs/integration-mcp";
import { describe, expect, it } from "vitest";
import { McpToolsError, withMcpToolsErrors } from "./errors.ts";

const failWith = (error: unknown) => () => Promise.reject(error);

describe("withMcpToolsErrors", () => {
  it("turns the MCP client's error into ours, with its code and message", async () => {
    const error = await withMcpToolsErrors(
      failWith(new McpError("rate-limited", "The MCP server asks to try again later.")),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(McpToolsError);
    expect(error).toMatchObject({
      code: "rate-limited",
      message: "The MCP server asks to try again later.",
    });
  });

  it("tells the user to try again when the server ended the session", async () => {
    await expect(
      withMcpToolsErrors(failWith(new McpError("session-expired", "Connect again."))),
    ).rejects.toMatchObject({
      name: "McpToolsError",
      code: "session-expired",
      message: "The MCP server ended the session. Try again.",
    });
  });

  it("lets every other error through unchanged, such as the kit's or an abort", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    await expect(withMcpToolsErrors(failWith(abort))).rejects.toBe(abort);
  });

  it("returns what the work returns", async () => {
    await expect(withMcpToolsErrors(async () => "done")).resolves.toBe("done");
  });
});
