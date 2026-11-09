import { z } from "zod";

/**
 * A calendar in the account's calendar list, as Google returns it, and the
 * small object `calendar_list_calendars` returns for it. Tools never pass
 * Google's response on as it is (guide, section 5).
 */

/** The fields a listing asks Google for: only what {@link CalendarDetails} shows. */
export const calendarEntryFields = "id,summary,summaryOverride,timeZone,accessRole,primary";

/** Only the fields we ask for, and all but `id` may be missing. */
export const calendarEntrySchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  /** The name the account gave the calendar itself, which wins over `summary`. */
  summaryOverride: z.string().optional(),
  timeZone: z.string().optional(),
  // A string, not an enum: a role Google adds later mustn't break the listing.
  accessRole: z.string().optional(),
  // Google sends `primary` only for the primary calendar.
  primary: z.boolean().optional(),
});
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;

/**
 * One calendar as the tool returns it, with its fields in the order the
 * description names them. A field Google didn't send is `undefined`, which
 * the JSON result leaves out.
 */
export interface CalendarDetails {
  id: string;
  name: string | undefined;
  timeZone: string | undefined;
  accessRole: string | undefined;
  primary: boolean;
}

/** Turns Google's calendar list entry into {@link CalendarDetails}. */
export function calendarDetails(entry: CalendarEntry): CalendarDetails {
  return {
    id: entry.id,
    name: entry.summaryOverride ?? entry.summary,
    timeZone: entry.timeZone,
    accessRole: entry.accessRole,
    primary: entry.primary ?? false,
  };
}
