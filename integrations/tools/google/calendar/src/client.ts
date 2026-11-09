import {
  type GoogleApi,
  googleApi,
  googleUrl,
  withNextPageToken,
} from "@halonicjs/integration-tool-google-shared";
import { z } from "zod";
import { calendarEntryFields, calendarEntrySchema } from "./calendar-entry.ts";
import {
  type CalendarEvent,
  calendarEventSchema,
  eventFields,
  listedEventFields,
} from "./event.ts";
import type { EventChanges } from "./event-changes.ts";
import type { IntegrationHost } from "./kit.ts";
import { writtenEventFields } from "./written-event.ts";

/**
 * The Calendar API's base URL. It has no host of its own, so it shares
 * www.googleapis.com with Drive.
 * https://developers.google.com/workspace/calendar/api/v3/reference
 */
const calendarBaseUrl = "https://www.googleapis.com/calendar/v3/";

/**
 * Every request that changes an event says `sendUpdates=none`, so Google
 * mails no invitation, update or cancellation to its guests. Inviting
 * people by mail is a `send` of its own (README, "Not yet").
 * https://developers.google.com/workspace/calendar/api/v3/reference/events/insert#parameters
 */
const noMail = { sendUpdates: "none" } as const;

/** `calendar_get_event` returns at most this many guests; Google then sets `attendeesOmitted`. */
export const maxGuests = 100;

const calendarListSchema = withNextPageToken(
  z.object({ items: z.array(calendarEntrySchema).default([]) }),
);
export type CalendarList = z.infer<typeof calendarListSchema>;

const eventListSchema = withNextPageToken(
  z.object({ items: z.array(calendarEventSchema).default([]) }),
);
export type EventList = z.infer<typeof eventListSchema>;

/** One page of a calendar's events. */
export interface ListEventsRequest {
  calendarId: string;
  /** RFC 3339 with an offset: only events that end after it. */
  timeMin: string;
  /** RFC 3339 with an offset: only events that start before it. */
  timeMax?: string | undefined;
  /** Google's free-text search in titles, descriptions, locations and guest names. */
  text?: string | undefined;
  maxResults: number;
  pageToken?: string | undefined;
}

/**
 * Every Calendar request goes through this class. The Google library adds
 * the account's access token, maps Google's errors to `GoogleError` and
 * never retries a request that changes something. Tools call these methods
 * and never build requests themselves.
 */
export class CalendarClient {
  readonly #google: GoogleApi;

  constructor(host: IntegrationHost) {
    this.#google = googleApi(host, { secret: "google-account", service: "Google Calendar" });
  }

  /** One request: a page of the account's calendar list. */
  async listCalendars(
    page: { maxResults: number; pageToken?: string | undefined },
    signal?: AbortSignal,
  ): Promise<CalendarList> {
    const url = googleUrl(calendarBaseUrl, ["users", "me", "calendarList"], {
      maxResults: page.maxResults,
      pageToken: page.pageToken,
      fields: `nextPageToken,items(${calendarEntryFields})`,
    });
    return await this.#google.getJson(url, calendarListSchema, signal);
  }

  /**
   * One request: a page of a calendar's events in a time range. Repeating
   * events come as their occurrences (`singleEvents`), which is also what
   * lets Google sort them by start time.
   * https://developers.google.com/workspace/calendar/api/v3/reference/events/list
   */
  async listEvents(request: ListEventsRequest, signal?: AbortSignal): Promise<EventList> {
    const url = googleUrl(calendarBaseUrl, ["calendars", request.calendarId, "events"], {
      timeMin: request.timeMin,
      timeMax: request.timeMax,
      q: request.text,
      maxResults: request.maxResults,
      pageToken: request.pageToken,
      singleEvents: true,
      orderBy: "startTime",
      fields: `nextPageToken,items(${listedEventFields})`,
    });
    return await this.#google.getJson(url, eventListSchema, signal);
  }

  /** One request: one event, with at most {@link maxGuests} guests. */
  async getEvent(
    calendarId: string,
    eventId: string,
    signal?: AbortSignal,
  ): Promise<CalendarEvent> {
    const url = googleUrl(calendarBaseUrl, ["calendars", calendarId, "events", eventId], {
      maxAttendees: maxGuests,
      fields: eventFields,
    });
    return await this.#google.getJson(url, calendarEventSchema, signal);
  }

  /**
   * One request, never retried: a timeout doesn't prove the event wasn't
   * created, and a second try could create it twice.
   */
  async createEvent(
    calendarId: string,
    event: EventChanges,
    signal?: AbortSignal,
  ): Promise<CalendarEvent> {
    const url = googleUrl(calendarBaseUrl, ["calendars", calendarId, "events"], {
      ...noMail,
      fields: writtenEventFields,
    });
    return await this.#google.postJson(url, event, calendarEventSchema, signal);
  }

  /**
   * One request, never retried: changes only the fields in `changes`, and
   * leaves the rest of the event as it is.
   * https://developers.google.com/workspace/calendar/api/v3/reference/events/patch
   */
  async updateEvent(
    calendarId: string,
    eventId: string,
    changes: EventChanges,
    signal?: AbortSignal,
  ): Promise<CalendarEvent> {
    const url = googleUrl(calendarBaseUrl, ["calendars", calendarId, "events", eventId], {
      ...noMail,
      fields: writtenEventFields,
    });
    const request = {
      method: "PATCH",
      url,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(changes),
      signal,
    } as const;
    return await this.#google.sendJson(request, calendarEventSchema);
  }

  /** One request, never retried. Google answers a delete with an empty body. */
  async deleteEvent(calendarId: string, eventId: string, signal?: AbortSignal): Promise<void> {
    const url = googleUrl(calendarBaseUrl, ["calendars", calendarId, "events", eventId], noMail);
    await this.#google.delete(url, signal);
  }
}
