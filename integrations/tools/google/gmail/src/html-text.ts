/**
 * Mail HTML as plain text for the model, as the old connector did it: line
 * breaks where blocks end, tags removed and the common entities decoded.
 * Not a full HTML parser on purpose; the result is only ever read.
 */

/**
 * The entities mail HTML uses most, in the old connector's order. `&amp;`
 * comes second, so `&amp;lt;` also becomes `<`; harmless for text that is
 * only read.
 */
const entities: readonly (readonly [RegExp, string])[] = [
  [/&nbsp;/g, " "],
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
];

export function htmlToText(html: string): string {
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  for (const [entity, character] of entities) {
    text = text.replace(entity, character);
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Inline styles that hide text from a person reading the mail: no display,
 * hidden, zero size or opacity, or white or transparent text. Newsletters
 * use them for preview text; an attacker can use them to show the model
 * words the user never sees.
 */
const hidingStyle =
  /style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d]*[1-9])|opacity\s*:\s*0(?![.\d]*[1-9])|(?<![\w-])color\s*:\s*(#fff(fff)?\b|white\b|transparent))/i;

export function hidesText(html: string): boolean {
  return hidingStyle.test(html);
}
