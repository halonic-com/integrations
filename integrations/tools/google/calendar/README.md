# tool-google-calendar

Google Calendar tools for agents: list calendars and events, read an
event, and create, change and delete events. Built on the Google library
in [`../shared`](../shared/README.md), which makes every request, keeps the
retry rules and turns Google's errors into `GoogleError`.

## Connecting it

Connect a Google account in Halonic and tick Calendar. Halonic's Google
sign-in asks for two scopes:

| Scope                            | Why                                                      |
| -------------------------------- | -------------------------------------------------------- |
| `calendar.calendarlist.readonly` | lists the calendars, for `calendar_list_calendars`       |
| `calendar.events`                | reads, creates, changes and deletes events, nothing else |

`calendar.events` doesn't cover the calendar list, and
`calendar.calendarlist.readonly` covers nothing else, so together they are
the fewest that make every tool work. `calendar.readonly` isn't asked for:
next to `calendar.events` it would only add calendar settings and sharing,
which no tool reads. Neither is the full `calendar` scope, which can also
share and delete whole calendars.

Halonic keeps the refresh token itself; Calendar only names the secret
(`google-account`), and the kit adds the access token to requests to
`www.googleapis.com`. The Calendar API has no host of its own, and that
host also serves Gmail, Drive and other Google APIs, so the host list
doesn't keep the token to Calendar; the scopes do.

The Google Cloud project needs the Google Calendar API
(`calendar-json.googleapis.com`) switched on. After sign-in, Halonic checks
it by reading the account's access role for its primary calendar.

## Tools

| Tool                      | `risk` | What it does                                                   |
| ------------------------- | ------ | -------------------------------------------------------------- |
| `calendar_list_calendars` | `read` | the calendars in the account's calendar list                   |
| `calendar_list_events`    | `read` | one calendar's events in a time range, with an optional search |
| `calendar_get_event`      | `read` | one event, with its description, organizer and guests          |
| `calendar_create_event`   | `send` | a new event without guests                                     |
| `calendar_update_event`   | `send` | changes an event's title, time, location or description        |
| `calendar_delete_event`   | `send` | deletes an event                                               |

Every tool's result is a small JSON object. Every tool that returns titles,
names or text other people may have written is `untrusted`, so Halonic
fences it off from instructions: invitations and calendars shared with the
account are written by other people.

**No tool e-mails anyone.** The three changing tools always send
`sendUpdates=none`, so Google sends no invitation, update or cancellation
mail.

The three changing tools are still `send`, not `write`, because each can
put content where other people see it ([guide, "Choosing
`risk`"](../../../../docs/guides/integrations.md#choosing-risk)): a calendar
can be shared with other people, and an event's guests see a change to it
on their own calendars, mail or no mail. A tool can't check whether a
calendar is shared without the scope that reads its sharing, so the
stricter `risk` applies. Approvals and the "allow sending" setting act on
it.

## Limits

- **Requests per call:** every tool makes one request.
- **Results** are cut: at most 250 calendars and 100 events per call, with
  `nextPageToken` when there is more. An event's description is cut after
  10,000 characters, and `calendar_get_event` returns at most 100 guests.
  Characters are UTF-16 code units, so an emoji counts as two.
- **Times** are RFC 3339 with an offset, such as
  `2026-11-10T09:00:00+01:00`, or a date for an all-day event. An
  integration has no clock, so `calendar_list_events` can't start at
  today by itself: it needs a `timeMin`.
- **Retries:** the Google library retries a read at most twice, after a
  `429` or a `5xx`, waiting with the host's `wait`. Creating, changing and
  deleting are never retried: a timeout doesn't prove nothing changed.
- **Errors** are `GoogleError` from the Google library. Google's own error
  text is never passed on.

## Not yet

- **Inviting guests.** Adding guests to an event, and letting Google mail
  them an invitation, is a `send` that reaches people outside the account.
  It needs its own tool and its own review, and comes in a later change.
- **Repeating events** can be read, changed and deleted, but not created.
- **Meeting links**, free/busy and calendar settings aren't read.
