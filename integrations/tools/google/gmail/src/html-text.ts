/**
 * Mail HTML as plain text for the model, as the old connector did it: line
 * breaks where blocks end, tags removed and the common entities decoded.
 * Not a full HTML parser on purpose; the result is only ever read.
 *
 * Every pattern here that waits for something to close (a tag's `>`, an
 * element's end tag, a CSS comment's `*\/`) also stops at the end of the
 * HTML. Browsers read an unclosed tag the same way, and it keeps each
 * pattern linear: a pattern that needs the closer scans to the end again
 * from every opening that has none, and a large mail full of unclosed tags
 * then takes minutes.
 */

/** Any tag, or an unclosed one up to the end. */
const anyTag = /<[^>]+(?:>|$)/g;

/**
 * A link: its attributes, then its text up to `</a>`. The attributes are
 * read as a browser reads them. A quote starts a value only right after
 * `=`; anywhere else, such as inside an unquoted value, it is an ordinary
 * character, so `<a x=a">` ends at its first `>`. A quoted value that never
 * closes runs to the end, and so does the tag.
 */
const link =
  /<a\b((?:[^>=]|=\s*(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s>]*))*)(?:>|$)([\s\S]*?)(?:<\/a>|$)/gi;

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
    .replace(/<style[\s\S]*?(?:<\/style>|$)/gi, "")
    .replace(/<script[\s\S]*?(?:<\/script>|$)/gi, "")
    .replace(link, withLinkAddress)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(anyTag, "");
  for (const [entity, character] of entities) {
    text = text.replace(entity, character);
  }
  return decodeNumericEntities(text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A link as `text <address>`, the way mail programs write it in a plain-text
 * part, so the model still knows where a link goes. Only web and mail
 * addresses are kept; the address is left out when the text already is it.
 * The brackets go in as entities, so removing the tags leaves them alone.
 *
 * An address with quotes or angle brackets is left out: a real link encodes
 * them, and the model must never be told a wrong address. Long addresses are
 * cut, because the reader only sees them on hover.
 */
function withLinkAddress(_link: string, attributes: string, inner: string): string {
  const address = attributeValue(attributes, "href")?.trim() ?? "";
  if (!/^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(address)) return inner;
  const withoutScheme = address.replace(/^mailto:/i, "");
  const innerText = inner.replace(anyTag, "").trim();
  if (innerText === address || innerText === withoutScheme) return inner;
  const shown = shortened(withoutScheme);
  return innerText === "" ? `&lt;${shown}&gt;` : `${inner} &lt;${shown}&gt;`;
}

/**
 * The value of one attribute, read the way a browser reads the tag: the
 * attributes in order from the start, each quoted value as a whole. So an
 * `href=` inside another attribute's value is never taken for the link.
 * The first one counts when a name repeats, as in a browser.
 */
function attributeValue(attributes: string, wanted: string): string | undefined {
  const attribute =
    /\s*([^\s/>][^\s/>=]*)(?:\s*=\s*(?:"([^"]*)(?:"|$)|'([^']*)(?:'|$)|([^\s>]*)))?/y;
  let position = 0;
  while (position < attributes.length) {
    attribute.lastIndex = position;
    const match = attribute.exec(attributes);
    if (match === null || match[0] === "") {
      // A stray `/` or trailing space between attributes: step over it.
      position += 1;
      continue;
    }
    if (match[1]?.toLowerCase() === wanted) return match[2] ?? match[3] ?? match[4] ?? "";
    position = attribute.lastIndex;
  }
  return undefined;
}

const longestShownAddress = 200;

function shortened(address: string): string {
  return address.length <= longestShownAddress
    ? address
    : `${address.slice(0, longestShownAddress)}…`;
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
  for (const attribute of html.matchAll(/\sstyle\s*=\s*(?:(["'])(.*?)(?:\1|$)|([^\s"'>]+))/gis)) {
    const css = withoutComments(attribute[2] ?? attribute[3] ?? "");
    if (hidingDeclaration.test(css) || invisibleColor.test(css)) return true;
  }
  for (const block of html.matchAll(/<style[^>]*(?:>|$)([\s\S]*?)(?:<\/style>|$)/gi)) {
    if (hidingDeclaration.test(withoutComments(block[1] ?? ""))) return true;
  }
  return hasHiddenAttribute(html);
}

/** CSS without its comments, so `display:/**\/none` reads as `display:none`. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "");
}

/** `<div hidden>`, but not `class="hidden"` or `type="hidden"`. */
function hasHiddenAttribute(html: string): boolean {
  for (const [tag] of html.matchAll(/<[a-z][^>]*(?:>|$)/gi)) {
    const attributeNames = tag.replace(/"[^"]*"|'[^']*'/g, '""');
    if (/\shidden(?=[\s=/>])/i.test(attributeNames)) return true;
  }
  return false;
}
