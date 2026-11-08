import { z } from "zod";

/**
 * Argument schemas more than one tool uses. Each tool adds its own
 * `describe`, word for word as in integration.yaml.
 */

/**
 * A file, folder or shared drive id, or `root`. Drive's ids are letters,
 * digits, `-` and `_`, so anything else is refused before a request is
 * made.
 */
export const driveIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

/** The file id every tool that works on one file takes. */
export const fileIdSchema = driveIdSchema.describe(
  "The file's id, from drive_search or drive_tree.",
);

/** Drive's page tokens are a few hundred characters; this only stops a made-up one from being huge. */
export const pageTokenSchema = z.string().min(1).max(1_000);

/**
 * A name for a new or renamed file or folder. Drive accepts long names;
 * the limit keeps an argument the model writes bounded (guide, section 5).
 */
export const fileNameSchema = z.string().min(1).max(1_000);

/**
 * The text of an upload. A multipart upload takes at most 5 MB
 * (https://developers.google.com/workspace/drive/api/guides/manage-uploads#multipart).
 * A UTF-16 code unit is at most 3 bytes in UTF-8, so a million of them stay
 * below that, with room for the metadata.
 */
export const uploadTextSchema = z.string().max(1_000_000);
