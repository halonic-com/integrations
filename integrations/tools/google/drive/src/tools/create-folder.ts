import { z } from "zod";
import type { DriveClient } from "../client.ts";
import type { ToolImplementation } from "../kit.ts";
import { type WrittenFolder, writtenFolder } from "../written-file.ts";
import { driveIdSchema, fileNameSchema } from "./arguments.ts";

const createFolderArguments = z.strictObject({
  name: fileNameSchema.describe("The new folder's name."),
  parentId: driveIdSchema
    .optional()
    .describe("Folder to create it in; people who can see that folder can see the new one."),
});

/** What the tool promises in its description, and nothing more. */
interface CreateFolderResult {
  folder: WrittenFolder;
}

export const createFolderTool = {
  declaration: {
    name: "drive_create_folder",
    description:
      "Creates a folder, at the top of My Drive or inside parentId. Returns its id, name and link.",
    parameters: z.toJSONSchema(createFolderArguments, { io: "input" }),
    // parentId may be a folder other people can see, and the tool doesn't
    // check (guide, "Choosing risk").
    risk: "send",
    untrusted: false,
  },
  arguments: createFolderArguments,
  // One request, never retried.
  async run(client, args, signal): Promise<CreateFolderResult> {
    return { folder: writtenFolder(await client.createFolder(args.name, args.parentId, signal)) };
  },
} satisfies ToolImplementation<DriveClient, typeof createFolderArguments>;
