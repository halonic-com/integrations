import { z } from "zod";

/**
 * Argument schemas more than one tool uses. Each tool adds its own
 * `describe`, word for word as in integration.yaml, unless the text is the
 * same for every tool, as for `calendarId` and `eventId`.
 */

/**
 * A calendar id: `primary`, an address such as `team@group.calendar.google.com`,
 * or a public calendar such as `en.usa#holiday@group.v.calendar.google.com`.
 * Anything else is refused before a request is made; the Google library
 * also refuses `.` and `..`, which would change the path.
 */
export const calendarIdValueSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9._@#+-]+$/);

/** The calendar every tool that reads or changes events takes. */
export const calendarIdSchema = calendarIdValueSchema
  .default("primary")
  .describe(
    'Calendar id from calendar_list_calendars, or "primary" (default) for the main calendar.',
  );

/**
 * An event id. Google's are base32hex, and an occurrence of a repeating
 * event adds `_` and its start, such as `abc123_20261110T090000Z`.
 * https://developers.google.com/workspace/calendar/api/v3/reference/events#id
 */
export const eventIdSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^[A-Za-z0-9_-]+$/)
  .describe("The event's id, from calendar_list_events.");

/** Google's page tokens are a few hundred characters; this only stops a made-up one from being huge. */
export const pageTokenSchema = z.string().min(1).max(2_000);

/** A date and time with an offset (`Z` counts), as Google takes it: RFC 3339. */
export const dateTimeSchema = z.iso.datetime({ offset: true });

/**
 * When a new or changed event starts or ends: a date such as `2026-11-10`
 * for an all-day event, or a date and time with an offset.
 */
export const eventTimeSchema = z.union([z.iso.date(), dateTimeSchema]);

/** Google takes long titles; the limit keeps an argument the model writes bounded (guide, section 5). */
export const titleSchema = z.string().min(1).max(1_000);

/** A place: an address, a room or a link. */
export const locationSchema = z.string().max(1_000);

/** As long as `calendar_get_event` returns at most, so a changed description can be read back whole. */
export const descriptionSchema = z.string().max(10_000);
