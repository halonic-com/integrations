import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { CalendarClient } from "./client.ts";
import { type Integration, runTool, type ToolImplementation } from "./kit.ts";
import { createEventTool } from "./tools/create-event.ts";
import { deleteEventTool } from "./tools/delete-event.ts";
import { getEventTool } from "./tools/get-event.ts";
import { listCalendarsTool } from "./tools/list-calendars.ts";
import { listEventsTool } from "./tools/list-events.ts";
import { updateEventTool } from "./tools/update-event.ts";

/** The same tools, in the same order, as in integration.yaml. */
const tools: readonly ToolImplementation<CalendarClient>[] = [
  listCalendarsTool,
  listEventsTool,
  getEventTool,
  createEventTool,
  updateEventTool,
  deleteEventTool,
];

export const calendar: Integration = {
  name: "tool-google-calendar",
  version: "0.1.0",
  tools: tools.map((tool) => tool.declaration),
  connect(host) {
    // No request here: Calendar is only called when a tool is.
    const client = new CalendarClient(host);
    return {
      callTool: (name, args, signal) =>
        runTool(
          tools,
          client,
          { name, args, signal },
          (code, message) => new GoogleError(code, message),
        ),
      close: async () => {},
    };
  },
};

export type { Integration, IntegrationHost, IntegrationTool } from "./kit.ts";
