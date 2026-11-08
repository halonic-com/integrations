import { z } from "zod";
import type { DriveClient } from "../client.ts";
import type { ToolImplementation } from "../kit.ts";
import { type MovedFile, movedFile } from "../written-file.ts";
import { driveIdSchema, fileIdSchema, fileNameSchema } from "./arguments.ts";

const moveFileArguments = z.strictObject({
  fileId: fileIdSchema,
  toFolderId: driveIdSchema.describe("The folder to move it into."),
  newName: fileNameSchema.optional().describe("A new name for the file."),
});

/** What the tool promises in its description, and nothing more. */
interface MoveFileResult {
  file: MovedFile;
}

export const moveFileTool = {
  declaration: {
    name: "drive_move_file",
    description:
      "Moves a file into toFolderId, optionally renaming it. The file is then visible to the people who can see that folder. Returns its id, name, parents and link.",
    parameters: z.toJSONSchema(moveFileArguments, { io: "input" }),
    // The file takes on the sharing of the folder it moves into, so a move
    // changes who can see it (guide, "Choosing risk").
    risk: "send",
    // The file's name comes back, and someone else may have chosen it.
    untrusted: true,
  },
  arguments: moveFileArguments,
  // Two requests: one read of the file's folders (retried where the Google
  // library allows) and one move (never retried).
  async run(client, args, signal): Promise<MoveFileResult> {
    const fromParents = await client.getParents(args.fileId, signal);
    const move = {
      fileId: args.fileId,
      fromParents,
      toFolderId: args.toFolderId,
      newName: args.newName,
    };
    return { file: movedFile(await client.moveFile(move, signal)) };
  },
} satisfies ToolImplementation<DriveClient, typeof moveFileArguments>;
