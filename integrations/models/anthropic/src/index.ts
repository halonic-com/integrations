import type { Integration } from "@halonicjs/adapters/integration-kit";
import { AnthropicError } from "./errors.ts";
import { createAnthropicProvider } from "./provider.ts";

/** Claude models through Anthropic's Messages API. A model provider only: it has no tools. */
export const anthropic: Integration = {
  name: "model-anthropic",
  version: "0.1.0",
  tools: [],
  connect(host) {
    return {
      callTool: async () => {
        throw new AnthropicError("not-found", "model-anthropic has no tools.");
      },
      createLlmProvider: (config) => createAnthropicProvider(host.http, config),
      close: async () => {},
    };
  },
};

export { AnthropicError, type AnthropicErrorCode } from "./errors.ts";
