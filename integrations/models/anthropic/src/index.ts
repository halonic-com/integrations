import { AnthropicError } from "./errors.ts";
import type { Integration } from "./kit.ts";

/**
 * Claude models through Anthropic's Messages API. A model provider only: it
 * has no tools. `createLlmProvider` follows with the provider's `chat`.
 */
export const anthropic: Integration = {
  name: "model-anthropic",
  version: "0.1.0",
  tools: [],
  connect() {
    return {
      callTool: async () => {
        throw new AnthropicError("not-found", "model-anthropic has no tools.");
      },
      close: async () => {},
    };
  },
};

export { AnthropicError, type AnthropicErrorCode } from "./errors.ts";
