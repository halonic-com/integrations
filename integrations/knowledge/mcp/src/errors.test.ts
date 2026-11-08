import { McpError } from "@halonicjs/integration-mcp";
import { describe, expect, it } from "vitest";
import { KnowledgeMcpError, withKnowledgeErrors } from "./errors.ts";

describe("withKnowledgeErrors", () => {
  it("returns what the work returns", async () => {
    await expect(withKnowledgeErrors(async () => 42)).resolves.toBe(42);
  });

  it("turns an McpError into a KnowledgeMcpError with the same code and message", async () => {
    const work = withKnowledgeErrors(async () => {
      throw new McpError("rate-limited", "The MCP server is busy. Try again later.");
    });
    await expect(work).rejects.toBeInstanceOf(KnowledgeMcpError);
    await expect(work).rejects.toMatchObject({
      name: "KnowledgeMcpError",
      code: "rate-limited",
      message: "The MCP server is busy. Try again later.",
    });
  });

  it("lets every other error through unchanged, such as the kit's", async () => {
    class IntegrationRefusedError extends Error {}
    const refused = new IntegrationRefusedError("secret-not-configured");
    await expect(
      withKnowledgeErrors(async () => {
        throw refused;
      }),
    ).rejects.toBe(refused);
  });
});
