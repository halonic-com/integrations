import type { Integration } from "@halonicjs/adapters/integration-kit";
import { GeminiError } from "./errors.ts";
import { createGeminiProvider } from "./provider.ts";

/** Google's Gemini models through the Gemini API, with an API key. A model provider only: it has no tools. */
export const gemini: Integration = {
  name: "model-gemini",
  version: "0.1.0",
  tools: [],
  connect(host) {
    return {
      callTool: async () => {
        throw new GeminiError("not-found", "model-gemini has no tools.");
      },
      createLlmProvider: (config) => createGeminiProvider(host.http, config),
      close: async () => {},
    };
  },
};

export { GeminiError, type GeminiErrorCode } from "./errors.ts";
