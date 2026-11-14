import type { Integration } from "@halonicjs/adapters/integration-kit";
import { OpenAiError } from "./errors.ts";
import { createOpenAiProvider } from "./provider.ts";

/** GPT models through OpenAI's Chat Completions API. A model provider only: it has no tools. */
export const openai: Integration = {
  name: "model-openai",
  version: "0.1.0",
  tools: [],
  connect(host) {
    return {
      callTool: async () => {
        throw new OpenAiError("not-found", "model-openai has no tools.");
      },
      createLlmProvider: (config) => createOpenAiProvider(host.http, config),
      close: async () => {},
    };
  },
};

export { OpenAiError, type OpenAiErrorCode } from "./errors.ts";
