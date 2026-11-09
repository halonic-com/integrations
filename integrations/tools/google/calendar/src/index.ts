import { GoogleError } from "@halonicjs/integration-tool-google-shared";
import { CalendarClient } from "./client.ts";
import { type Integration, runTool, type ToolImplementation } from "./kit.ts";
import { getEventTool } from "./tools/get-event.ts";
import { listCalendarsTool } from "./tools/list-calendars.ts";
import { listEventsTool } from "./tools/list-events.ts";

/**
 * The same tools, in the same order, as in integration.yaml. The tools
 * that change events follow in the next pull request.
 */
const tools: readonly ToolImplementation<CalendarClient>[] = [
  listCalendarsTool,
  listEventsTool,
  getEventTool,
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
