import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { DriveClient } from "../client.ts";
import { convertToSchema, newFileMetadata } from "../new-file-metadata.ts";
import { contentTypeSchema } from "../upload-body.ts";
import { type WrittenFile, writtenFile } from "../written-file.ts";
import { driveIdSchema, fileNameSchema, uploadTextSchema } from "./arguments.ts";

const createFileArguments = z.strictObject({
  name: fileNameSchema.describe("The new file's name."),
  content: uploadTextSchema.describe("The file's text."),
  mimeType: contentTypeSchema,
  folderId: driveIdSchema
    .optional()
    .describe("Folder to create it in; people who can see that folder can see the file."),
  convertTo: convertToSchema,
});

/** What the tool promises in its description, and nothing more. */
interface CreateFileResult {
  file: WrittenFile;
}

export const createFileTool = {
  declaration: {
    name: "drive_create_file",
    description:
      'Creates a file from text content, at the top of My Drive or inside folderId. Set convertTo "document" (with mimeType text/markdown, text/html or text/plain) to get a Google Doc, or "spreadsheet" (with text/csv) to get a Google Sheet. Returns its id, name, type and link.',
    parameters: z.toJSONSchema(createFileArguments, { io: "input" }),
    // folderId may be a folder other people can see, and the tool doesn't
    // check (guide, "Choosing risk").
    risk: "send",
    untrusted: false,
  },
  arguments: createFileArguments,
  // One request, never retried.
  async run(client, args, signal): Promise<CreateFileResult> {
    const metadata = newFileMetadata({
      name: args.name,
      contentType: args.mimeType,
      folderId: args.folderId,
      convertTo: args.convertTo,
    });
    const content = { type: args.mimeType, text: args.content };
    return { file: writtenFile(await client.createFile(metadata, content, signal)) };
  },
} satisfies ToolImplementation<DriveClient, typeof createFileArguments>;
