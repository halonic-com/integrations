import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { CalendarClient } from "../client.ts";
import { checkTimes, eventChanges } from "../event-changes.ts";
import { type WrittenEvent, writtenEvent } from "../written-event.ts";
import {
  calendarIdSchema,
  descriptionSchema,
  eventIdSchema,
  eventTimeSchema,
  locationSchema,
  titleSchema,
} from "./arguments.ts";

/** The arguments that change something. At least one of them must be passed. */
const changeFields = ["title", "start", "end", "location", "description"] as const;

const updateEventArguments = z
  .strictObject({
    eventId: eventIdSchema,
    calendarId: calendarIdSchema,
    title: titleSchema.optional().describe("The new title."),
    start: eventTimeSchema
      .optional()
      .describe(
        'New start: a date such as "2026-11-10" for an all-day event, or a time with an offset such as "2026-11-10T09:00:00+01:00". Pass end with it.',
      ),
    end: eventTimeSchema
      .optional()
      .describe("New end, in the same form as start. Pass start with it."),
    location: locationSchema.optional().describe("The new location; an empty text removes it."),
    description: descriptionSchema
      .optional()
      .describe("New notes as plain text; an empty text removes them."),
  })
  .superRefine((args, context) => {
    if (changeFields.every((field) => args[field] === undefined)) {
      // No path: the problem is the arguments as a whole.
      context.addIssue({ code: "custom", message: "Pass at least one change." });
    }
    checkTimes(args, context);
  });

/** What the tool promises in its description, and nothing more. */
interface UpdateEventResult {
  event: WrittenEvent;
}

export const updateEventTool = {
  declaration: {
    name: "calendar_update_event",
    description:
      "Changes an event's title, time, location or description; what you leave out stays as it is. Guests aren't e-mailed, but they and everyone who can see the calendar see the change. An occurrence's id changes only that occurrence. Returns its id, title, start, end and link.",
    parameters: z.toJSONSchema(updateEventArguments, { io: "input" }),
    // Guests and people the calendar is shared with see the change.
    risk: "send",
    // The title it returns may be one someone else wrote, when it isn't changed.
    untrusted: true,
  },
  arguments: updateEventArguments,
  // One request, never retried.
  async run(client, args, signal): Promise<UpdateEventResult> {
    const changes = eventChanges(args);
    const event = await client.updateEvent(args.calendarId, args.eventId, changes, signal);
    return { event: writtenEvent(event) };
  },
} satisfies ToolImplementation<CalendarClient, typeof updateEventArguments>;
