import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { DriveClient } from "../client.ts";
import { type FileDetails, fileDetails } from "../file.ts";
import { fileIdSchema } from "./arguments.ts";

const getFileArguments = z.strictObject({
  fileId: fileIdSchema,
});

/** What the tool promises in its description, and nothing more. */
interface GetFileResult {
  file: FileDetails;
}

export const getFileTool = {
  declaration: {
    name: "drive_get_file",
    description:
      "Returns a file's details: name, type, size, modified time, owners, parents, link and whether it is in the trash.",
    parameters: z.toJSONSchema(getFileArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: getFileArguments,
  // One request.
  async run(client, args, signal): Promise<GetFileResult> {
    return { file: fileDetails(await client.getFile(args.fileId, signal)) };
  },
} satisfies ToolImplementation<DriveClient, typeof getFileArguments>;
