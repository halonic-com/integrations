import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import { type CalendarDetails, calendarDetails } from "../calendar-entry.ts";
import type { CalendarClient } from "../client.ts";
import { pageTokenSchema } from "./arguments.ts";

/** Google's own limit for one page of the calendar list. */
export const maxCalendars = 250;

const listCalendarsArguments = z.strictObject({
  maxResults: z
    .int()
    .min(1)
    .max(maxCalendars)
    .default(50)
    .describe("Calendars to return (default 50)."),
  pageToken: pageTokenSchema
    .optional()
    .describe("nextPageToken from the previous call, for more calendars."),
});

/** What the tool promises in its description, and nothing more. */
interface ListCalendarsResult {
  calendars: CalendarDetails[];
  nextPageToken?: string;
}

export const listCalendarsTool = {
  declaration: {
    name: "calendar_list_calendars",
    description:
      "Lists the calendars in the account's calendar list: id, name, time zone, the account's access role and whether it is the primary calendar. Pass an id as calendarId to calendar_list_events.",
    parameters: z.toJSONSchema(listCalendarsArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: listCalendarsArguments,
  // One request.
  async run(client, args, signal): Promise<ListCalendarsResult> {
    const page = await client.listCalendars(args, signal);
    const result: ListCalendarsResult = { calendars: page.items.map(calendarDetails) };
    if (page.nextPageToken !== undefined) result.nextPageToken = page.nextPageToken;
    return result;
  },
} satisfies ToolImplementation<CalendarClient, typeof listCalendarsArguments>;
