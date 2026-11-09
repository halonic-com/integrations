import { anthropic } from "../src/index.ts";
import type { ProviderConfig, Scenario } from "../src/kit.ts";

/** The sheet decides the key and the host, so the config only names the provider. */
const config: ProviderConfig = { id: "claude", type: "anthropic", local: false, options: {} };

/** The paths of a streamed answer, which `chat` never gets. */
const streamedContent = [
  "response.body[*].data.content_block.text",
  "response.body[*].data.content_block.thinking",
  "response.body[*].data.content_block.input",
  "response.body[*].data.delta.text",
  "response.body[*].data.delta.thinking",
  "response.body[*].data.delta.partial_json",
];

export const integration = anthropic;
export const scenarios: readonly Scenario[] = [
  {
    name: "answer-text", // saved as recordings/answer-text.json
    unusedUserContent: [
      "request.body.messages[*].content[*].content",
      "request.body.messages[*].content[*].input",
      "request.body.tools[*].description",
      "response.body.content[*].thinking",
      "response.body.content[*].input",
      ...streamedContent,
    ],
    async run(connection) {
      const provider = connection.createLlmProvider?.(config);
      if (provider === undefined) {
        throw new Error("model-anthropic offers no model provider.");
      }
      await provider.chat({
        model: "claude-haiku-4-5-20251001",
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Say hello." },
        ],
        params: { maxTokens: 1024 },
      });
    },
  },
];
