# tool-paperclip-issues

Paperclip tasks for agents, read only: list a company's tasks and an
agent's inbox, and read a task, its comments and its documents.
A Halonic workflow uses it to read a Paperclip task board, for example to
draft a news update from the week's tasks.

- **Layer:** integrations
- **Owner:** tomas

## Connecting it

The workspace gives the connection two settings:

| Setting      | What                                                      |
| ------------ | --------------------------------------------------------- |
| `url`        | the Paperclip server, such as `https://tasks.example.com` |
| `company-id` | the id of the company whose tasks the tools read          |

Paperclip is self-hosted, so it has no host of its own: the sheet's one
host is the host of `url`, of class `public`. The kit refuses any other
host, an IP address and plain `http` (`setting-outside-class`).

The key (`paperclip-key`) goes only to that host, as
`Authorization: Bearer`. Use a key that can only read. Halonic keeps it;
the integration only names it, so it never sees the value, and it isn't
in any prompt, document, run log or recording.

## Tools

| Tool                   | `risk` | What it does                                              |
| ---------------------- | ------ | --------------------------------------------------------- |
| `issues_list`          | `read` | the company's tasks, filtered by status, assignee or text |
| `issues_get`           | `read` | one task, with its blockers and its document keys         |
| `issues_list_comments` | `read` | one task's comments, oldest first                         |
| `issues_get_document`  | `read` | one document of a task                                    |
| `issues_list_inbox`    | `read` | the tasks assigned to the agent the key belongs to        |

Every tool's result is a small JSON object, never Paperclip's own
response. Every tool is `untrusted`: titles, descriptions, comments and
documents are written by people and agents, so Halonic fences them off
from instructions.

**Nothing changes Paperclip.** There is no tool that writes, so a call to
any other tool name is refused before a request is made, and the client
sends only `GET` requests. A key that can only read is a third line of
defence, on Paperclip's side.

## Limits

- **Requests per call:** every tool makes one request.
- **Results** are cut: at most 50 tasks and 100 comments per call, with
  `nextOffset` or `nextAfter` when there may be more. Paperclip sends the
  whole inbox at once, so `issues_list_inbox` returns its first 50 tasks and
  says in `notShown` how many it left out. A description is cut
  after 20,000 characters, a comment after 10,000 and a document after
  50,000. A title in a list is cut after 500. Characters are UTF-16 code
  units, so an emoji counts as two.
- **Paging** asks Paperclip for one item more than it returns, to know
  whether there are more. Paperclip's `after` sends the comment it names
  back as the first one; `issues_list_comments` leaves it out, so
  `nextAfter` never repeats a comment.
- **A stale `after`** looks like the end: when `after` names a comment id
  Paperclip doesn't find, it answers `200` with no comments rather than an
  error, so the tool returns none and no `nextAfter`.
- **`issues_list` pages by offset** over the tasks most recently changed
  first. A task that changes between two calls moves to the front, so the
  next page can show a task again or skip one.
- **Deleted comments** aren't returned: Paperclip still lists them, with
  their text.
- **`issues_list_inbox`** only works with an agent's key: the inbox belongs
  to the agent the key was issued to.
- **No retries:** a call that gets a `429` or a `5xx` fails with
  `rate-limited` or `unavailable`, and the agent can try again later. The
  retry code Google's integrations share lives in `tools/google/shared`,
  and the guide doesn't allow copying it; a retry helper belongs in the
  kit.
- **Errors** are `PaperclipError`. Paperclip's own error text is never
  passed on.

## Recordings

There is no test Paperclip server yet, so the files in `recordings/` are
invented traffic, shaped like the answers of a live Paperclip server:
invented tasks, comments and ids on `tasks.example.com`. They were fed
through the recorder's `prepareRecording` with this sheet's `userContent`
paths, so they are scrubbed exactly as a real recording would be, and
every path was checked to match. Besides titles, descriptions and comment
text, the paths cover the other free text Paperclip sends with a task or a
comment (notes, labels, review and blocker summaries, comment metadata)
and its error text. With one task, Paperclip also sends the plan's text,
the project, the workspace's folders and commands, and the words that
mention other tasks; the paths cover these too. So do a task's run and
recovery state, which holds monitor notes, recovery notes and run errors,
and the titles of the tasks that block its blockers. Some fields were
`null` on every one of about 800 live tasks we looked at (`watchdog`,
`workspaceSelection`, `workspacePendingSelection`, `conversationState`,
`externalConversationState`, `externalChannelBinding`,
`assigneeAdapterOverrides`, `reviewPolicy`): we can't see what they hold,
so they are declared as content too. The recordings carry them as `null`,
as Paperclip sends them. Replace the recordings with real ones once there
is a test server.

Two things the recorder does that the tests show:

- A field named `key` is a secret to the recorder, so a document's key in
  a recording is a stand-in such as `scrubbed-secret-1`.
- The invented plan in `get-issue` has fewer than 10 fields: the replay
  numbers the fields of a scrubbed object again in the file's sorted order
  (`field-1`, `field-10`, `field-2`), so one with 10 or more no longer
  matches. The fix is in `tooling/record`.

## Not yet

- Attachments, activity and runs aren't read.
