import { OpenAiError } from "./errors.ts";
import type { Integration } from "./kit.ts";

/**
 * GPT models through OpenAI's Chat Completions API. A model provider only:
 * it has no tools. `createLlmProvider` follows with the provider's `chat`.
 */
export const openai: Integration = {
  name: "model-openai",
  version: "0.1.0",
  tools: [],
  connect() {
    return {
      callTool: async () => {
        throw new OpenAiError("not-found", "model-openai has no tools.");
      },
      close: async () => {},
    };
  },
};

export { OpenAiError, type OpenAiErrorCode } from "./errors.ts";
