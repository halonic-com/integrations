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
  `nextOffset` or `nextAfter` when there may be more. A description is cut
  after 20,000 characters, a comment after 10,000 and a document after
  50,000. A title in a list is cut after 500. Characters are UTF-16 code
  units, so an emoji counts as two.
- **Paging** asks Paperclip for one item more than it returns, to know
  whether there are more. Paperclip's `after` sends the comment it names
  back as the first one; `issues_list_comments` leaves it out, so
  `nextAfter` never repeats a comment.
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
and its error text. Replace them with real recordings once there is a
test server.

## Not yet

- `issues_get`, `issues_get_document` and `issues_list_inbox`, and with
  them the shared conformance suite: it checks the code's tools against
  the sheet's five, so it runs once all five are in, in the next pull
  request. Until then, `read-only.test.ts` checks that the code's tools
  are the sheet's, read only, and send nothing but `GET` with the key.
- Attachments, activity and runs aren't read.
