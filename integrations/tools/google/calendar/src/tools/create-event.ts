import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { CalendarClient } from "../client.ts";
import { checkTimes, eventChanges } from "../event-changes.ts";
import { type WrittenEvent, writtenEvent } from "../written-event.ts";
import {
  calendarIdValueSchema,
  descriptionSchema,
  eventTimeSchema,
  locationSchema,
  titleSchema,
} from "./arguments.ts";

const createEventArguments = z
  .strictObject({
    calendarId: calendarIdValueSchema
      .default("primary")
      .describe('Calendar to add it to, from calendar_list_calendars, or "primary" (default).'),
    title: titleSchema.describe("The event's title."),
    start: eventTimeSchema.describe(
      'Start: a date such as "2026-11-10" for an all-day event, or a time with an offset such as "2026-11-10T09:00:00+01:00".',
    ),
    end: eventTimeSchema.describe(
      "End, in the same form as start. An all-day event ends on the day after its last day.",
    ),
    location: locationSchema.optional().describe("Where it takes place."),
    description: descriptionSchema.optional().describe("Notes for the event, as plain text."),
  })
  .superRefine(checkTimes);

/** What the tool promises in its description, and nothing more. */
interface CreateEventResult {
  event: WrittenEvent;
}

export const createEventTool = {
  declaration: {
    name: "calendar_create_event",
    description:
      "Creates an event without guests. Nobody is e-mailed, but everyone who can see the calendar sees the event. Returns its id, title, start, end and link.",
    parameters: z.toJSONSchema(createEventArguments, { io: "input" }),
    // Anyone the calendar is shared with sees the new event (guide, "Choosing risk").
    risk: "send",
    untrusted: false,
  },
  arguments: createEventArguments,
  // One request, never retried.
  async run(client, args, signal): Promise<CreateEventResult> {
    const event = await client.createEvent(args.calendarId, eventChanges(args), signal);
    return { event: writtenEvent(event) };
  },
} satisfies ToolImplementation<CalendarClient, typeof createEventArguments>;
