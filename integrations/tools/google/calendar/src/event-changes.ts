import type { z } from "zod";

/**
 * What `calendar_create_event` and `calendar_update_event` send to Google:
 * the event body, built from the tools' arguments, and the checks on their
 * times. Never guests: a tool that adds guests reaches people outside the
 * account and needs its own review (README, "Not yet").
 */

/** When an event starts or ends, as Google takes it. */
export type EventTimeBody = { date: string } | { dateTime: string };

/** The fields a create sends, and the ones an update changes. A field left out stays as it is. */
export interface EventChanges {
  summary?: string;
  start?: EventTimeBody;
  end?: EventTimeBody;
  location?: string;
  description?: string;
}

/** The tools' arguments that become {@link EventChanges}. */
export interface EventArguments {
  title?: string | undefined;
  start?: string | undefined;
  end?: string | undefined;
  location?: string | undefined;
  description?: string | undefined;
}

/** A date alone, such as `2026-11-10`, means an all-day event. */
function isDate(time: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(time);
}

/** A date for an all-day event, a date and time for any other. */
export function eventTimeBody(time: string): EventTimeBody {
  return isDate(time) ? { date: time } : { dateTime: time };
}

/** The body Google gets, with only the fields the caller passed. */
export function eventChanges(args: EventArguments): EventChanges {
  const changes: EventChanges = {};
  if (args.title !== undefined) changes.summary = args.title;
  if (args.start !== undefined) changes.start = eventTimeBody(args.start);
  if (args.end !== undefined) changes.end = eventTimeBody(args.end);
  if (args.location !== undefined) changes.location = args.location;
  if (args.description !== undefined) changes.description = args.description;
  return changes;
}

/**
 * Whether `end` is too early for `start`. An all-day event's end is the day
 * after its last day, so it must come after the start; a timed event may
 * end when it starts. Dates compare as text; times compare as instants,
 * since their offsets may differ.
 */
function endsTooEarly(start: string, end: string): boolean {
  if (isDate(start)) return end <= start;
  return Date.parse(end) < Date.parse(start);
}

/**
 * Checks that start and end come together, are of one kind (two dates or
 * two times) and in order. Google refuses either mistake, but its answer
 * can't say which argument was wrong; this check can, before any request.
 * Used in each tool's `superRefine`, so a problem is reported as the
 * argument's name.
 */
export function checkTimes(args: EventArguments, context: z.RefinementCtx): void {
  if (args.start !== undefined && args.end === undefined) {
    context.addIssue({ code: "custom", path: ["end"], message: "Pass end with start." });
  }
  if (args.end !== undefined && args.start === undefined) {
    context.addIssue({ code: "custom", path: ["start"], message: "Pass start with end." });
  }
  if (args.start !== undefined && args.end !== undefined) {
    if (isDate(args.start) !== isDate(args.end)) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Start and end are both dates or both times.",
      });
    } else if (endsTooEarly(args.start, args.end)) {
      context.addIssue({ code: "custom", path: ["end"], message: "End comes after start." });
    }
  }
}
