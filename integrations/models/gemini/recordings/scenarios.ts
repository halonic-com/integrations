import type {
  ChatMessage,
  LlmProvider,
  ProviderConfig,
  ToolDefinition,
} from "@halonicjs/adapters/integration-kit";
import { gemini } from "../src/index.ts";
import type { Scenario } from "../src/scenario.ts";

/** The sheet decides the key and the host, so the config only names the provider. */
const config: ProviderConfig = { id: "gemini", type: "gemini", local: false, options: {} };

/** The paths of a streamed answer, which `chat` never gets. */
const streamedContent = [
  "response.body[*].data.candidates[*].content.parts[*].text",
  "response.body[*].data.candidates[*].content.parts[*].functionCall.args.*",
  "response.body[*].data.error.message",
];

const weatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Gets the current weather for a city.",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

/**
 * A run that started on another model: the earlier assistant turn has no
 * Gemini replay, so model-gemini rebuilds it from `toolCalls`. With no
 * signature on the call, it sends Google's `skip_thought_signature_validator`.
 */
function switchedConversation(toolCallId: string): ChatMessage[] {
  return [
    { role: "system", content: "Answer in one short sentence." },
    { role: "user", content: "What is the weather in Ghent?" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: toolCallId, name: weatherTool.name, arguments: { city: "Ghent" } }],
    },
    { role: "tool", toolCallId, name: weatherTool.name, content: "Sunny, 18 degrees." },
  ];
}

function providerOf(connection: Parameters<Scenario["run"]>[0]): LlmProvider {
  const provider = connection.createLlmProvider?.(config);
  if (provider === undefined) {
    throw new Error("model-gemini offers no model provider.");
  }
  return provider;
}

export const integration = gemini;
export const scenarios: readonly Scenario[] = [
  {
    /**
     * Shows that Google takes a rebuilt function call after a model switch,
     * with the skip signature, in two requests:
     * 1. Another provider's id on the call and its response.
     * 2. No id on either, as after a switch from Gemini 2.5, whose ids
     *    model-gemini makes up and never sends.
     *
     * Gemini 2.5 itself isn't recorded: Google no longer offers it to new
     * accounts, so a test account can't call it.
     */
    name: "model-switch",
    unusedUserContent: [
      "response.body.candidates[*].content.parts[*].functionCall.args.*",
      ...streamedContent,
    ],
    async run(connection) {
      const provider = providerOf(connection);
      const cases = [
        { model: "gemini-3-flash-preview", toolCallId: "toolu_01ExampleSwitchedCall" },
        { model: "gemini-3-flash-preview", toolCallId: "gemini-call-0" },
      ];
      for (const { model, toolCallId } of cases) {
        await provider.chat({
          model,
          messages: switchedConversation(toolCallId),
          tools: [weatherTool],
          params: { maxTokens: 1024 },
        });
      }
    },
  },
];
