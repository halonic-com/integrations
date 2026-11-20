import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { PaperclipClient } from "../client.ts";
import { type DocumentDetail, documentDetail } from "../document.ts";
import { issueSchema } from "./arguments.ts";

const getDocumentArguments = z.strictObject({
  issue: issueSchema,
  key: z
    .string()
    .min(1)
    .max(100)
    // Paperclip's keys are words joined by hyphens, such as `migration-plan`.
    // No dots or slashes, so the key can't change the path it goes into.
    .regex(/^[A-Za-z0-9_-]+$/)
    .describe('Key of the document, such as "plan".'),
});

export const getDocumentTool = {
  declaration: {
    name: "issues_get_document",
    description:
      "Returns one document of a task: key, title, text and last change. The text is cut after 50,000 characters. issues_get lists a task's document keys.",
    parameters: z.toJSONSchema(getDocumentArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: getDocumentArguments,
  // One request.
  async run(client, args, signal): Promise<DocumentDetail> {
    return documentDetail(await client.getDocument(args.issue, args.key, signal));
  },
} satisfies ToolImplementation<PaperclipClient, typeof getDocumentArguments>;
