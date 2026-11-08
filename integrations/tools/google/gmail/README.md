# tool-google-gmail

Gmail tools for agents: search and read mail, label it, write drafts and
send. Built on the Google library in [`../shared`](../shared/README.md),
which makes every request, keeps the retry rules and turns Google's errors
into `GoogleError`.

## Connecting it

Connect a Google account in Halonic and tick Gmail. Halonic's Google sign-in
asks for one scope, `gmail.modify`: read, label, draft and send, but never
delete for good. It keeps the refresh token itself; Gmail only names the
secret (`google-account`), and the kit adds the access token to requests to
`gmail.googleapis.com`.

## Tools

| Tool                  | `risk`  | What it does                                                     |
| --------------------- | ------- | ---------------------------------------------------------------- |
| `gmail_triage`        | `read`  | searches and reads the matches in one call, bodies cut to fit    |
| `gmail_search`        | `read`  | Gmail search syntax; headers and snippet per message             |
| `gmail_read_message`  | `read`  | one message: headers, body as text in pages, attachments         |
| `gmail_read_thread`   | `read`  | a conversation, oldest first, in pages                           |
| `gmail_list_labels`   | `read`  | label ids and names                                              |
| `gmail_get_draft`     | `read`  | a draft as it will be sent, `bcc` included                       |
| `gmail_modify_labels` | `write` | adds and removes labels: read, archive, star; never Trash, Spam  |
| `gmail_create_draft`  | `write` | a draft in the account's Drafts folder, with signature and quote |
| `gmail_send`          | `send`  | sends a mail; can't be undone                                    |
| `gmail_send_draft`    | `send`  | sends an existing draft; can't be undone                         |

Every tool's result is a small JSON object. Every tool that returns mail is
`untrusted`, so Halonic fences the content off from instructions. The two
`send` tools are what the "allow sending" setting of a connection and the
approvals act on; Halonic refuses them while sending is off.

## Limits

- **Requests per call** are fixed and small. Each tool says how many it
  makes at most; the largest is `gmail_triage`, with one list request and
  one request per message (at most 26), not counting retries.
- **Results** are cut: at most 25 messages per search, bodies in pages of
  `maxBodyChars`, threads in pages of `maxMessages`, at most 500 labels.
- **Retries** follow the Google library
  ([`../shared`](../shared/README.md#retries)): reads are sent again at
  most twice after a `429` or a `5xx`, waiting with the host's `wait`.
  Nothing that changes the mailbox is retried, and sending never is: a
  timeout doesn't prove the mail wasn't sent.
- **Errors** are `GoogleError` from the Google library. Google's own error
  text is never passed on.

## Differences from the old Studio connector

The tools come from the old connector and keep its behaviour, except where
[the integration guide](../../../../docs/guides/integrations.md) asks for
something else:

- **`gmail_get_draft` returns `bcc`** (allowed difference
  `google.get-draft-returns-bcc`, plan phase 3), so an approval shows every
  recipient.
- **No hard-coded "sending off" switch.** The old build refused to send in
  code. Sending is now the connection's "allow sending" setting, checked by
  Halonic against `risk: send`.
- **No fences or notices in results.** The old tools wrapped bodies in
  random `UNTRUSTED` markers and added a notice. Halonic now does that for
  every `untrusted` tool, and random markers would make replays differ.
- **No account address in results, and no `From` header.** The sign-in
  belongs to Halonic, so Gmail doesn't know the address; Gmail fills in
  `From` with the account's own address, and the signature comes from the
  account's primary send-as address.
- **Limits on every list:** `gmail_search` returns at most 25 messages (was
  50); `gmail_read_thread` and `gmail_get_draft` return their content in
  pages; search and triage return `nextPageToken`.
- **`gmail_send` quotes the original of a reply only when asked**
  (`quoteOriginal: true`). An approval shows the arguments, not the quoted
  text, so a reply sent straight away doesn't carry text the approver
  hasn't seen. `gmail_create_draft` still quotes by default:
  `gmail_get_draft` shows the whole draft before it's sent.
- **`gmail_modify_labels` refuses to add `TRASH` or `SPAM`.** Gmail deletes
  trashed mail for good after 30 days, and spam is reported to Google;
  neither is a label change the user expects from this tool.
- **Reads are retried** after a `429` or a `5xx`, as the guide's rule 10
  and the Google library ask. The old connector never retried. Nothing that
  changes the mailbox is retried.
- **The model reads what a person sees.** Gmail shows a mail's HTML part,
  and the sender writes the plain-text part too, so they can make the two
  say different things. The reading tools still prefer the plain part, but
  only while it has no words the HTML lacks (more than three, after link
  addresses and image placeholders are left out). Otherwise the model gets
  the HTML as text and a `warning`. The hidden-text `warning` now also
  looks at the HTML when there is a plain part, and also catches `<style>`
  rules, the `hidden` attribute and `mso-hide:all`. Both are heuristics:
  they warn, they never refuse.
- **The signature is read on every send**, not kept in a cache for ten
  minutes: an integration keeps no state between calls. If it can't be
  read, the tool fails before anything is sent, instead of sending without
  it.
- **`gmail_save_attachment_to_drive` isn't here.** It writes to Google
  Drive, which is a different host and a different service the user may not
  have ticked. Where it goes is still to be decided.
- **No tool descriptions or results name another integration's tools.**

## Recordings

The files in `recordings/` weren't recorded against Gmail: `pnpm record`
and a Google test account aren't available yet. They come from the real
recorder's code (`prepareRecording` from `tooling/record`, HAL-149), fed
with invented traffic shaped like Gmail's documented answers: invented
names, `example.com` addresses, and search queries such as
`subject:halonic-test`. So they are scrubbed exactly as a real recording
would be, which also checks this sheet's `userContent` paths. Replace them
with real recordings once both are available.
