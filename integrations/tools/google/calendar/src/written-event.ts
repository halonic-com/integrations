import { type CalendarEvent, timeText } from "./event.ts";

/**
 * What the tools that create or change an event return: the few fields
 * their descriptions promise, not the full `EventDetails`. Google is asked
 * for only these, so the answer holds no guests or description.
 */

/** The fields a create or update asks Google to answer with. */
export const writtenEventFields = "id,summary,start,end,htmlLink";

/** One created or changed event as a tool returns it. */
export interface WrittenEvent {
  id: string;
  title: string | undefined;
  start: string | undefined;
  end: string | undefined;
  link: string | undefined;
}

/** Turns Google's answer into {@link WrittenEvent}. */
export function writtenEvent(event: CalendarEvent): WrittenEvent {
  return {
    id: event.id,
    title: event.summary,
    start: timeText(event.start),
    end: timeText(event.end),
    link: event.htmlLink,
  };
}
