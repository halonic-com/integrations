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
  return decodeNumericEntities(text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `&#233;` and `&#xE9;`, which mail programs use for every letter outside ASCII. */
function decodeNumericEntities(text: string): string {
  return text.replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
    const point =
      code[0] === "x" || code[0] === "X" ? Number.parseInt(code.slice(1), 16) : Number(code);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

/**
 * CSS that hides text from a person reading the mail: no display, hidden,
 * zero size or opacity, or Outlook's own `mso-hide`. Newsletters use it for
 * preview text; an attacker can use it to show the model words the user
 * never sees.
 */
const hidingDeclaration =
  /(display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|font-size\s*:\s*0(?![.\d]*[1-9])|opacity\s*:\s*0(?![.\d]*[1-9]))/i;

/**
 * White or transparent text. Only checked in a `style` attribute: in a
 * `<style>` block it is mostly a button's label on a coloured background.
 */
const invisibleColor = /(?<![\w-])color\s*:\s*(#fff(fff)?\b|white\b|transparent)/i;

/**
 * True when the HTML hides some of its text: through a `style` attribute,
 * a rule in a `<style>` block (such as `.x{display:none}`) or the `hidden`
 * attribute. A heuristic, so a warning, never a refusal.
 */
export function hidesText(html: string): boolean {
  for (const attribute of html.matchAll(/\sstyle\s*=\s*(["'])(.*?)\1/gis)) {
    const css = attribute[2] ?? "";
    if (hidingDeclaration.test(css) || invisibleColor.test(css)) return true;
  }
  for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (hidingDeclaration.test(block[1] ?? "")) return true;
  }
  return hasHiddenAttribute(html);
}

/** `<div hidden>`, but not `class="hidden"` or `type="hidden"`. */
function hasHiddenAttribute(html: string): boolean {
  for (const [tag] of html.matchAll(/<[a-z][^>]*>/gi)) {
    const attributeNames = tag.replace(/"[^"]*"|'[^']*'/g, '""');
    if (/\shidden(?=[\s=/>])/i.test(attributeNames)) return true;
  }
  return false;
}
