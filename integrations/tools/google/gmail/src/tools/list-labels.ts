import { z } from "zod";
import type { GmailClient, Label } from "../client.ts";
import type { ToolImplementation } from "../kit.ts";

/** Gmail allows 10,000 labels; a result that long wouldn't help the model. */
export const maxLabels = 500;

const listLabelsArguments = z.strictObject({});

interface ListLabelsResult {
  labels: Label[];
  /** How many labels were left out, when there are more than {@link maxLabels}. */
  omittedLabels?: number;
}

export const listLabelsTool = {
  declaration: {
    name: "gmail_list_labels",
    description: "Lists label ids and names, for gmail_modify_labels and search.",
    parameters: z.toJSONSchema(listLabelsArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: listLabelsArguments,
  // 1 request.
  async run(client, _args, signal) {
    const labels = await client.listLabels(signal);
    const result: ListLabelsResult = {
      labels: labels.slice(0, maxLabels).map(({ id, name, type }) => ({ id, name, type })),
    };
    if (labels.length > maxLabels) result.omittedLabels = labels.length - maxLabels;
    return result;
  },
} satisfies ToolImplementation<GmailClient, typeof listLabelsArguments>;
