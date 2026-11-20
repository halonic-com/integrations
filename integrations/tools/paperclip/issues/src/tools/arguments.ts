import { z } from "zod";

/**
 * Argument schemas more than one tool uses. Each tool adds its own
 * `describe`, word for word as in integration.yaml, unless the text is the
 * same for every tool, as for `issue`.
 */

/**
 * A Paperclip id: a UUID, or a task identifier such as `HAL-12`. Letters,
 * digits and hyphens only, so the id can't change the path it goes into,
 * and anything else is refused before a request is made.
 */
export const paperclipIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9-]+$/);

/** The task a tool reads. */
export const issueSchema = paperclipIdSchema.describe(
  'Identifier of the task, such as "HAL-12", or its id.',
);
