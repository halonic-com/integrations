import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { CalendarClient } from "../client.ts";
import { type EventSummary, eventSummary } from "../event.ts";
import { calendarIdSchema, dateTimeSchema, pageTokenSchema } from "./arguments.ts";

/** Google allows 2,500 events per page; 100 keeps one result small enough for the model. */
export const maxEvents = 100;

const listEventsArguments = z.strictObject({
  calendarId: calendarIdSchema,
  // Required: an integration has no clock, so it can't start at today by itself.
  timeMin: dateTimeSchema.describe(
    'Only events that end after this time, with an offset, such as "2026-11-10T00:00:00+01:00".',
  ),
  timeMax: dateTimeSchema
    .optional()
    .describe("Only events that start before this time, in the same form as timeMin."),
  text: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("Words to find in titles, descriptions, locations and guest names."),
  maxResults: z.int().min(1).max(maxEvents).default(25).describe("Events to return (default 25)."),
  pageToken: pageTokenSchema
    .optional()
    .describe("nextPageToken from the previous call, for more events."),
});

/** What the tool promises in its description, and nothing more. */
interface ListEventsResult {
  events: EventSummary[];
  nextPageToken?: string;
}

export const listEventsTool = {
  declaration: {
    name: "calendar_list_events",
    description:
      "Lists the events of one calendar in a time range, earliest first, with each occurrence of a repeating event on its own. Returns id, title, start, end, whether it lasts all day, location, status and type per event. Read an event's description and guests with calendar_get_event.",
    parameters: z.toJSONSchema(listEventsArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: listEventsArguments,
  // One request.
  async run(client, args, signal): Promise<ListEventsResult> {
    const page = await client.listEvents(args, signal);
    const result: ListEventsResult = { events: page.items.map(eventSummary) };
    if (page.nextPageToken !== undefined) result.nextPageToken = page.nextPageToken;
    return result;
  },
} satisfies ToolImplementation<CalendarClient, typeof listEventsArguments>;
