import type { ToolImplementation } from "@halonicjs/adapters/integration-kit";
import { z } from "zod";
import type { CalendarClient } from "../client.ts";
import { calendarIdSchema, eventIdSchema } from "./arguments.ts";

const deleteEventArguments = z.strictObject({
  eventId: eventIdSchema,
  calendarId: calendarIdSchema,
});

/** What the tool promises in its description, and nothing more. */
interface DeleteEventResult {
  id: string;
}

/**
 * Deletes for good, which the guide asks a reviewer to agree to. Ravi and
 * Liam did, in the sheet's review (integrations#132).
 */
export const deleteEventTool = {
  declaration: {
    name: "calendar_delete_event",
    description:
      "Deletes an event. Guests aren't e-mailed. A repeating event's id deletes every occurrence; an occurrence's id deletes only that one. Returns the id.",
    parameters: z.toJSONSchema(deleteEventArguments, { io: "input" }),
    // An event the account organises disappears for its guests too.
    risk: "send",
    untrusted: false,
  },
  arguments: deleteEventArguments,
  // One request, never retried.
  async run(client, args, signal): Promise<DeleteEventResult> {
    await client.deleteEvent(args.calendarId, args.eventId, signal);
    return { id: args.eventId };
  },
} satisfies ToolImplementation<CalendarClient, typeof deleteEventArguments>;
