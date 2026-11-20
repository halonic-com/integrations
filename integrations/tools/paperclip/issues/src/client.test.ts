import {
  type IntegrationHttpClient,
  IntegrationRefusedError,
} from "@halonicjs/adapters/integration-kit";
import { testHost } from "@halonicjs/tooling-record/replay";
import { describe, expect, it } from "vitest";
import { paperclipIssues } from "./index.ts";
import { connectToFakePaperclip, paperclipError, settings } from "./test/replay.ts";

describe("PaperclipClient", () => {
  it.each([
    [400, "bad-arguments", "invalid_input"],
    [401, "not-signed-in", "unauthenticated"],
    [403, "not-allowed", "denied"],
    [404, "not-found", "not_found"],
    [408, "rate-limited", "limit_reached"],
    [410, "not-found", "not_found"],
    [422, "bad-arguments", "invalid_input"],
    [429, "rate-limited", "limit_reached"],
    [500, "unavailable", "unavailable"],
    [503, "unavailable", "unavailable"],
    [418, "unavailable", "unavailable"],
  ] as const)(
    "maps %i to %s, once, without Paperclip's text or the query",
    async (status, code, kind) => {
      const { connection, requests } = connectToFakePaperclip(status, paperclipError());
      const call = connection.callTool("issues_list", { text: "secret plan" });
      await expect(call).rejects.toMatchObject({ name: "PaperclipError", code, kind });
      await expect(call).rejects.not.toThrow(/secret plan|Invented/);
      await expect(call).rejects.toThrow(`(status ${status}).`);
      // No retries (README, "Limits").
      expect(requests).toHaveLength(1);
    },
  );

  it.each([
    ["isn't JSON", "<html>Invented secret plan</html>"],
    ["isn't a list", JSON.stringify({ error: "Invented secret plan" })],
    ["lacks a field", JSON.stringify([{ id: "t1", title: "Invented secret plan" }])],
  ])("refuses an answer that %s as unexpected-response, without quoting it", async (_, body) => {
    const { connection } = connectToFakePaperclip(200, body);
    const call = connection.callTool("issues_list", {});
    await expect(call).rejects.toMatchObject({
      code: "unexpected-response",
      message:
        "Paperclip answered tasks.example.com/api/companies/c0ffee00-0000-4000-8000-000000000001/issues in an unexpected way.",
    });
    await expect(call).rejects.not.toThrow(/Invented/);
  });

  it("goes to the server in the url setting, under its own path", async () => {
    const { connection, requests } = connectToFakePaperclip(200, "[]", {
      ...settings,
      url: "https://example.com/paperclip/",
    });
    await connection.callTool("issues_list_comments", { issue: "HAL-12" });
    expect(requests[0]?.url).toBe(
      "https://example.com/paperclip/api/issues/HAL-12/comments?order=asc&limit=51",
    );
  });

  it.each([
    ["url", { "company-id": settings["company-id"] }],
    ["url", { ...settings, url: "tasks.example.com" }],
    ["company-id", { url: settings.url }],
    ["company-id", { ...settings, "company-id": "../other" }],
    ["url, company-id", {}],
  ])(
    "refuses settings without a good %s as bad-config, before any request",
    async (fields, hostSettings) => {
      const { connection, requests } = connectToFakePaperclip(200, "[]", hostSettings);
      const call = connection.callTool("issues_list", {});
      await expect(call).rejects.toMatchObject({
        code: "bad-config",
        kind: "invalid_input",
        message: `Check the tool-paperclip-issues settings: ${fields}.`,
      });
      expect(requests).toHaveLength(0);
    },
  );

  it("lets the kit's own errors through unchanged", async () => {
    const refused = new IntegrationRefusedError("secret-not-configured", "Set up paperclip-key.");
    const http: IntegrationHttpClient = {
      fetch: () => Promise.reject(refused),
    };
    const connection = paperclipIssues.connect(testHost(http, { settings }));
    await expect(connection.callTool("issues_list", {})).rejects.toBe(refused);
  });
});
