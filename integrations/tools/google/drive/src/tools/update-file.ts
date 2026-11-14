import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { DriveClient } from "../client.ts";
import { contentTypeSchema } from "../upload-body.ts";
import { type WrittenFile, writtenFile } from "../written-file.ts";
import { fileIdSchema, uploadTextSchema } from "./arguments.ts";

const updateFileArguments = z.strictObject({
  fileId: fileIdSchema,
  content: uploadTextSchema.describe("The new text, replacing all of the old."),
  mimeType: contentTypeSchema,
});

/** What the tool promises in its description, and nothing more. */
interface UpdateFileResult {
  file: WrittenFile;
}

export const updateFileTool = {
  declaration: {
    name: "drive_update_file",
    description:
      "Replaces the content of an existing file, or of a Google Doc or Sheet when given text/html, text/plain or text/csv. Everyone the file is shared with sees the new content. Returns its id, name, type and link.",
    parameters: z.toJSONSchema(updateFileArguments, { io: "input" }),
    // The file may be shared with other people (guide, "Choosing risk").
    risk: "send",
    // The file's name comes back, and someone else may have chosen it.
    untrusted: true,
  },
  arguments: updateFileArguments,
  // One request, never retried. Drive converts the text when the file is a
  // Google Doc or Sheet, so the tool doesn't need to know the file's type.
  async run(client, args, signal): Promise<UpdateFileResult> {
    const content = { type: args.mimeType, text: args.content };
    return { file: writtenFile(await client.replaceFileContent(args.fileId, content, signal)) };
  },
} satisfies ToolImplementation<DriveClient, typeof updateFileArguments>;
