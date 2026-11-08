import { z } from "zod";

/**
 * Argument schemas more than one tool uses. Every string has a limit
 * (guide, section 5), so a made-up value can't be huge.
 */

/** A message, thread or draft id. Gmail's are about 16 to 20 characters. */
export const gmailIdSchema = z.string().min(1).max(200);

/** Gmail's page tokens are short; this only stops a made-up one from being huge. */
export const pageTokenSchema = z.string().min(1).max(500);

/** The most body characters one read returns, whatever the caller asks for. */
export const maxBodyCharsLimit = 60_000;

/** Bodies longer than this are read in pages; it only bounds the offset. */
export const bodyOffsetSchema = z.int().min(0).max(10_000_000).default(0);

export const includeInlineSchema = z
  .boolean()
  .default(false)
  .describe("Also list small inline images such as signature logos.");
