import { GeminiError } from "./errors.ts";
import type { Integration } from "./kit.ts";

/**
 * Google's Gemini models through the Gemini API, with an API key. A model
 * provider only: it has no tools. `createLlmProvider` follows with the
 * provider's `chat`.
 */
export const gemini: Integration = {
  name: "model-gemini",
  version: "0.1.0",
  tools: [],
  connect() {
    return {
      callTool: async () => {
        throw new GeminiError("not-found", "model-gemini has no tools.");
      },
      close: async () => {},
    };
  },
};

export { GeminiError, type GeminiErrorCode } from "./errors.ts";
