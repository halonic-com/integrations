import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { CalendarClient } from "../client.ts";
import { type EventDetails, eventDetails } from "../event.ts";
import { calendarIdSchema, eventIdSchema } from "./arguments.ts";

const getEventArguments = z.strictObject({
  eventId: eventIdSchema,
  calendarId: calendarIdSchema,
});

/** What the tool promises in its description, and nothing more. */
interface GetEventResult {
  event: EventDetails;
}

export const getEventTool = {
  declaration: {
    name: "calendar_get_event",
    description:
      "Returns one event: title, start, end, whether it lasts all day, location, description, status, type, organizer, guests with their answers and link, and for an occurrence of a repeating event the series id. A description is cut after 10,000 characters.",
    parameters: z.toJSONSchema(getEventArguments, { io: "input" }),
    risk: "read",
    untrusted: true,
  },
  arguments: getEventArguments,
  // One request.
  async run(client, args, signal): Promise<GetEventResult> {
    const event = await client.getEvent(args.calendarId, args.eventId, signal);
    return { event: eventDetails(event) };
  },
} satisfies ToolImplementation<CalendarClient, typeof getEventArguments>;
