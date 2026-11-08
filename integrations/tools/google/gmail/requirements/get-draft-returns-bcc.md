# google.get-draft-returns-bcc

- Status: active
- Since: 0.1.0
- Source: HAL-294; plan phase 3, allowed difference 17 (HAL-96)

When `gmail_get_draft` shows a draft, the Gmail integration shall return the
draft's Bcc recipients as `bcc`, next to `to` and `cc`, so that an approval
shows everyone the mail will reach.

The old connector left `bcc` out. A draft without a Bcc header has no `bcc`
field, the same as a draft without Cc has no `cc`.

## Examples

- Given a draft to "robin@example.com" with Bcc "kim@example.com",
  when `gmail_get_draft` shows it,
  then the result's `bcc` is "kim@example.com".
- Given a draft to "robin@example.com" without a Bcc header,
  when `gmail_get_draft` shows it,
  then the result has no `bcc` field.
