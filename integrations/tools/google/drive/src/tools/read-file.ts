import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { z } from "zod";
import type { DriveClient } from "../client.ts";
import { readPlan, textPart } from "../contents.ts";
import { type FileDetails, fileDetails } from "../file.ts";
import { fileIdSchema } from "./arguments.ts";

/** The most one read returns. The result goes into the model's context. */
export const maxReadChars = 100_000;

const readFileArguments = z.strictObject({
  fileId: fileIdSchema,
  maxChars: z
    .int()
    .min(1)
    .max(maxReadChars)
    .default(20_000)
    .describe("Characters to return (default 20000)."),
  offset: z
    .int()
    .min(0)
    .default(0)
    .describe("Where to start; use nextOffset from the previous read."),
});

/** What the tool promises in its description, and nothing more. A binary file has only `file`. */
interface ReadFileResult {
  file: FileDetails;
  /** The type the text is in: an export format, or the file's own type. */
  format?: string;
  content?: string;
  nextOffset?: number;
}

/** The text and the type it came in. */
interface FileText {
  format: string;
  text: string;
}

/**
 * Tries each export format in turn. Only a refusal of the format itself
 * (`bad-arguments`) moves on to the next; any other error, such as a file
 * too large to export, ends the call.
 */
async function exportText(
  client: DriveClient,
  fileId: string,
  formats: readonly string[],
  signal: AbortSignal | undefined,
): Promise<FileText> {
  let refused: GoogleError | undefined;
  for (const format of formats) {
    try {
      return { format, text: await client.exportFile(fileId, format, signal) };
    } catch (error) {
      if (!(error instanceof GoogleError) || error.code !== "bad-arguments") {
        throw error;
      }
      refused = error;
    }
  }
  // `formats` is never empty, so at least one format was refused.
  throw refused ?? new GoogleError("unexpected-response", "Google Drive exported nothing.");
}

export const readFileTool = {
  declaration: {
    name: "drive_read_file",
    description:
      "Returns a file's contents as text: Google Docs as Markdown, Sheets as CSV (first sheet), Slides as text, Drawings as SVG and text files as they are. Binary files, such as PDFs and images, return their details only. Long files come in parts: when nextOffset is present, call again with offset.",
    parameters: z.toJSONSchema(readFileArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: readFileArguments,
  // At most three requests: the details, then an export (with one fallback format) or a download.
  async run(client, args, signal): Promise<ReadFileResult> {
    const file = await client.getFile(args.fileId, signal);
    const plan = readPlan(file.mimeType);
    if (plan.kind === "binary") {
      return { file: fileDetails(file) };
    }
    const { format, text } =
      plan.kind === "export"
        ? await exportText(client, file.id, plan.formats, signal)
        : { format: plan.format, text: await client.downloadFile(file.id, signal) };
    return { file: fileDetails(file), format, ...textPart(text, args.offset, args.maxChars) };
  },
} satisfies ToolImplementation<DriveClient, typeof readFileArguments>;
