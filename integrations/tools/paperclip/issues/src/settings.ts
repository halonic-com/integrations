import { z } from "zod";
import { PaperclipError } from "./errors.ts";

/**
 * The connection's settings, checked before any request. They come from
 * the workspace, so a mistake is the user's to fix: the message names the
 * field, never its value. The key is not a setting: the kit adds
 * `paperclip-key` itself.
 */
export interface PaperclipSettings {
  /** The Paperclip server, such as `https://tasks.example.com`. The sheet allows its host and nothing else. */
  readonly url: string;
  /** The company whose tasks the tools read. */
  readonly companyId: string;
}

const settingsSchema = z.object({
  // The kit still refuses plain http, an IP address and any other host;
  // this only catches a setting that is no address at all.
  url: z
    .string()
    .max(2_048)
    .regex(/^https?:\/\/[^\s/?#]+[^\s?#]*$/i),
  // Paperclip's ids are UUIDs. Letters, digits and hyphens only, so the id
  // can't change the path it goes into.
  "company-id": z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9-]+$/),
});

/** @throws {PaperclipError} `bad-config`, naming the fields to fix */
export function readSettings(settings: Readonly<Record<string, unknown>>): PaperclipSettings {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(all)")),
    ];
    throw new PaperclipError(
      "bad-config",
      `Check the tool-paperclip-issues settings: ${fields.join(", ")}.`,
    );
  }
  return { url: parsed.data.url, companyId: parsed.data["company-id"] };
}
