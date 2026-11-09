import { z } from "zod";

/**
 * A Calendar event as Google returns it, and the small objects the tools
 * return for it. Tools never pass Google's response on as it is (guide,
 * section 5).
 */

/** The fields a listing asks Google for: only what {@link EventSummary} shows. */
export const listedEventFields = "id,summary,start,end,location,status,eventType";

/**
 * The fields one event is read with: the listed ones, and what only
 * {@link EventDetails} shows.
 */
export const eventFields = `${listedEventFields},description,organizer(email,displayName),attendees(email,displayName,responseStatus,optional),attendeesOmitted,htmlLink,recurringEventId`;

/** A description is cut after this many characters, so one event can't fill the model's context. */
export const maxDescriptionChars = 10_000;

/**
 * When an event starts or ends: `date` for an all-day event, `dateTime`
 * (RFC 3339 with an offset) for any other.
 * https://developers.google.com/workspace/calendar/api/v3/reference/events#resource
 */
const eventTimeSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
});
type EventTime = z.infer<typeof eventTimeSchema>;

/** A person on an event: the organizer or a guest. */
const personSchema = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
});

/**
 * A guest. `responseStatus` is a string, not an enum: an answer Google
 * adds later mustn't break the event.
 */
const attendeeSchema = personSchema.extend({
  responseStatus: z.string().optional(),
  optional: z.boolean().optional(),
});

/** Only the fields we ask for, and all but `id` may be missing. */
export const calendarEventSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  start: eventTimeSchema.optional(),
  end: eventTimeSchema.optional(),
  location: z.string().optional(),
  status: z.string().optional(),
  eventType: z.string().optional(),
  description: z.string().optional(),
  organizer: personSchema.optional(),
  attendees: z.array(attendeeSchema).optional(),
  /** Google sets it when the event has more guests than `maxAttendees` lets through. */
  attendeesOmitted: z.boolean().optional(),
  htmlLink: z.string().optional(),
  /** The series' id, on an occurrence of a repeating event. */
  recurringEventId: z.string().optional(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/**
 * One event in a listing, with its fields in the order the description
 * names them. A field Google didn't send is `undefined`, which the JSON
 * result leaves out.
 */
export interface EventSummary {
  id: string;
  title: string | undefined;
  start: string | undefined;
  end: string | undefined;
  allDay: boolean;
  location: string | undefined;
  status: string | undefined;
  type: string | undefined;
}

/** A person as the tools return them. */
export interface Person {
  address: string | undefined;
  name: string | undefined;
}

/** A guest and their answer: `accepted`, `declined`, `tentative` or `needsAction`. */
export interface Guest extends Person {
  answer: string | undefined;
  optional: boolean | undefined;
}

/** One event as `calendar_get_event` returns it. */
export interface EventDetails extends EventSummary {
  description: string | undefined;
  /** Only there when the description was cut after {@link maxDescriptionChars}. */
  descriptionTruncated?: true;
  organizer: Person | undefined;
  guests: Guest[];
  /** Only there when Google left guests out, because there were more than the tool asks for. */
  moreGuests?: true;
  link: string | undefined;
  seriesId: string | undefined;
}

/** Turns Google's event into {@link EventSummary}. */
export function eventSummary(event: CalendarEvent): EventSummary {
  return {
    id: event.id,
    title: event.summary,
    start: timeText(event.start),
    end: timeText(event.end),
    allDay: event.start?.date !== undefined,
    location: event.location,
    status: event.status,
    type: event.eventType,
  };
}

/** Turns Google's event into {@link EventDetails}, with the description cut to its limit. */
export function eventDetails(event: CalendarEvent): EventDetails {
  const details: EventDetails = {
    ...eventSummary(event),
    description: event.description?.slice(0, maxDescriptionChars),
    organizer: event.organizer === undefined ? undefined : person(event.organizer),
    guests: (event.attendees ?? []).map(guest),
    link: event.htmlLink,
    seriesId: event.recurringEventId,
  };
  if ((event.description?.length ?? 0) > maxDescriptionChars) details.descriptionTruncated = true;
  if (event.attendeesOmitted === true) details.moreGuests = true;
  return details;
}

/** A date for an all-day event, a date and time for any other. */
function timeText(time: EventTime | undefined): string | undefined {
  return time?.date ?? time?.dateTime;
}

function person(from: z.infer<typeof personSchema>): Person {
  return { address: from.email, name: from.displayName };
}

function guest(from: z.infer<typeof attendeeSchema>): Guest {
  return { ...person(from), answer: from.responseStatus, optional: from.optional };
}
