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
  50,000. Characters are UTF-16 code units, so an emoji counts as two.
- **`issues_list_inbox`** only works with an agent's key: the inbox belongs
  to the agent the key was issued to.
- **Retries:** a call is retried at most twice, after a `429` or a `5xx`,
  waiting with the host's `wait`. Every call only reads, so a retry changes
  nothing.
- **Errors** are `PaperclipError`. Paperclip's own error text is never
  passed on.

## Not yet

- The client and the tools come in the next pull request; this one adds
  the sheet, which comes first ([guide, section
  3](../../../../docs/guides/integrations.md#3-the-permission-sheet-comes-first)).
- Attachments, activity and runs aren't read.
