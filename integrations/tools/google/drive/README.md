# tool-google-drive

Google Drive tools for agents: find, list and read files, and create,
update and move them. Built on the Google library in
[`../shared`](../shared/README.md), which makes every request, keeps the
retry rules and turns Google's errors into `GoogleError`.

## Connecting it

Connect a Google account in Halonic and tick Drive. Halonic's Google
sign-in asks for one scope, `drive`. It keeps the refresh token itself;
Drive only names the secret (`google-account`), and the kit adds the access
token to requests to `www.googleapis.com`. That host also serves Gmail,
Calendar and other Google APIs, so the host list doesn't keep the token to
Drive; the scope does.

`drive` is the narrowest scope the tools work with: they search, read,
update and move files the user already has. `drive.file` reaches only files
Halonic created or the user opened with it, and `drive.readonly` can't
write. The scope also allows sharing and deleting, but no tool calls those
endpoints.

## Tools

| Tool                  | `risk` | What it does                                                       |
| --------------------- | ------ | ------------------------------------------------------------------ |
| `drive_tree`          | `read` | a folder and its subfolders, a few levels deep, in one call        |
| `drive_search`        | `read` | name and full-text search, a folder's files, or Drive query syntax |
| `drive_get_file`      | `read` | one file's details                                                 |
| `drive_read_file`     | `read` | a file's text in parts: Docs as Markdown, Sheets as CSV            |
| `drive_create_file`   | `send` | a new file from text, optionally as a Google Doc or Sheet          |
| `drive_update_file`   | `send` | replaces a file's content                                          |
| `drive_create_folder` | `send` | a new folder                                                       |
| `drive_move_file`     | `send` | moves a file into another folder, optionally renaming it           |

Every tool's result is a small JSON object. Every tool that returns names
or content other people may have written is `untrusted`, so Halonic fences
it off from instructions.

The four tools that change Drive are `send`, not `write`, because each can
put content where other people see it ([guide, "Choosing
`risk`"](../../../../docs/guides/integrations.md#choosing-risk)): a file or
folder created in a shared folder, new content in a shared file, a file
moved into a shared folder. None of them checks whether the target is
shared, so the stricter `risk` applies. Approvals and the "allow sending"
setting act on it.

## Limits

- **Requests per call** are fixed and small. Each tool says how many it
  makes at most; the largest is `drive_tree`, with at most 25 folder
  listings.
- **Results** are cut: at most 100 files per search, 1,000 items per tree
  and 100,000 characters per read, with `nextPageToken`, `truncated` or
  `nextOffset` when there is more.
- **Retries:** the Google library retries a read at most twice, after a
  `429` or a `5xx`, waiting with the host's `wait`. Creating, updating and
  moving are never retried: a timeout doesn't prove nothing changed.
- **Errors** are `GoogleError` from the Google library. Google's own error
  text is never passed on.

## Differences from the old Studio connector

The tools come from the old connector and keep its behaviour, except where
[the integration guide](../../../../docs/guides/integrations.md) asks for
something else:

- **The four changing tools are `send`** (was `write`), for the reason
  above.
- **No fences or notices in results.** The old `drive_read_file` wrapped
  contents in random `UNTRUSTED` markers. Halonic now does that for every
  `untrusted` tool, and random markers would make replays differ.
- **No account address in results.** The sign-in belongs to Halonic, so
  Drive doesn't know the address.
- **Limits and pages:** `drive_read_file` returns `maxChars` characters
  from `offset` and a `nextOffset` (was the first 100,000 characters);
  `drive_search` takes a `pageToken` and returns `nextPageToken`;
  `drive_tree` makes at most 25 listings and reads one page per folder,
  and says `truncated` when it stops early.
- **A fixed multipart boundary.** `drive_create_file` used a random one;
  it now picks one that isn't in the content, so the same call always
  sends the same request.
