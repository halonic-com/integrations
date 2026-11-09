import { anthropic } from "../src/index.ts";
import type {
  ChatMessage,
  IntegrationConnection,
  LlmProvider,
  ProviderConfig,
  Scenario,
  ToolDefinition,
} from "../src/kit.ts";

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

const weatherForecast: ToolDefinition = {
  name: "weather_forecast",
  description: "Tomorrow's weather forecast for one city.",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

export const integration = anthropic;
export const scenarios: readonly Scenario[] = [
  {
    name: "answer-text", // saved as recordings/answer-text.json
    unusedUserContent: [
      "request.body.messages[*].content[*].content",
      "request.body.messages[*].content[*].input",
      "request.body.messages[*].content[*].thinking",
      "request.body.tools[*].description",
      "response.body.content[*].thinking",
      "response.body.content[*].input",
      ...streamedContent,
    ],
    async run(connection) {
      await modelProvider(connection).chat({
        model: "claude-haiku-4-5-20251001",
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Say hello." },
        ],
        params: { maxTokens: 1024 },
      });
    },
  },
  {
    /**
     * HAL-316: a tool loop on a model that thinks by default. The second
     * call sends the first answer back through `replay`, thinking blocks and
     * their signatures included, and Anthropic has to accept it.
     */
    name: "tool-loop-thinking",
    unusedUserContent: streamedContent,
    async run(connection) {
      const provider = modelProvider(connection);
      const model = "claude-sonnet-5-5";
      const tools = [weatherForecast];
      const messages: ChatMessage[] = [
        { role: "system", content: "Use the tools you are given." },
        { role: "user", content: "Should I take an umbrella in Ghent tomorrow?" },
      ];

      const toolTurn = await provider.chat({ model, messages, tools, params: { maxTokens: 4096 } });
      const toolCall = toolTurn.toolCalls[0];
      if (toolCall === undefined) {
        throw new Error("The model answered without calling weather_forecast.");
      }
      if (!hasThinkingBlock(toolTurn.replay?.data)) {
        throw new Error("The model didn't think, so this recording wouldn't test replay.");
      }

      messages.push(
        {
          role: "assistant",
          content: toolTurn.content,
          toolCalls: toolTurn.toolCalls,
          ...(toolTurn.replay ? { replay: toolTurn.replay } : {}),
        },
        {
          role: "tool",
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: "Rain all day, 12 degrees.",
        },
      );
      const finalTurn = await provider.chat({
        model,
        messages,
        tools,
        params: { maxTokens: 4096 },
      });
      if (finalTurn.finishReason !== "stop") {
        throw new Error(`The follow-up turn ended with "${finalTurn.finishReason}", not "stop".`);
      }
    },
  },
];

function modelProvider(connection: IntegrationConnection): LlmProvider {
  const provider = connection.createLlmProvider?.(config);
  if (provider === undefined) {
    throw new Error("model-anthropic offers no model provider.");
  }
  return provider;
}

/** Whether the content Anthropic sent holds a thinking block, the part this scenario is about. */
function hasThinkingBlock(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((block: unknown) => {
      return (
        typeof block === "object" && block !== null && "type" in block && block.type === "thinking"
      );
    })
  );
}
