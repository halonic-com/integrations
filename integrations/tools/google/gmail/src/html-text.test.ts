import { describe, expect, it } from "vitest";
import { hidesText, htmlToText } from "./html-text.ts";

describe("htmlToText", () => {
  it("keeps the text, breaks lines where blocks end and drops styles and scripts", () => {
    const html =
      "<style>p{color:red}</style><p>Hello&nbsp;Sam,</p><div>See <b>below</b>.<br>Thanks</div><script>x()</script>";
    expect(htmlToText(html)).toBe("Hello Sam,\nSee below.\nThanks");
  });

  it("decodes the common entities and squeezes blank lines", () => {
    expect(
      htmlToText("<p>a &lt; b &amp;&amp; &quot;c&quot; &#39;d&#39;</p><p></p><p></p><p>e</p>"),
    ).toBe("a < b && \"c\" 'd'\n\ne");
  });

  it("writes a link as its text and its address, as a plain-text part does", () => {
    const html =
      '<p><a href="https://example.com/a?x=1&amp;y=2">the agenda</a>, ' +
      "<a href='mailto:sam@example.com'>Sam</a>, " +
      '<a href=https://example.com/b><img alt="Logo"></a></p>';
    expect(htmlToText(html)).toBe(
      "the agenda <https://example.com/a?x=1&y=2>, Sam <sam@example.com>, <https://example.com/b>",
    );
  });

  it("leaves out the address when the text is the address, or when it isn't a web or mail address", () => {
    const html =
      '<p><a href="https://example.com">https://example.com</a> ' +
      '<a href="mailto:sam@example.com">sam@example.com</a> ' +
      '<a href="#top">Top</a> <a href="javascript:void(0)">Open</a> <a name="x">Here</a></p>';
    expect(htmlToText(html)).toBe("https://example.com sam@example.com Top Open Here");
  });

  it.each([
    ['<a title="x href=https://bank.example" href="https://evil.example">Your bank</a>'],
    [`<a title='x href="https://bank.example"' href=https://evil.example>Your bank</a>`],
    ['<a data-x="1"href="https://evil.example" title="y href=https://bank.example">Your bank</a>'],
  ])(
    "takes the link address from the href attribute, never from another attribute's value: %s",
    (html) => {
      expect(htmlToText(html)).toBe("Your bank <https://evil.example>");
    },
  );

  it("takes the first href when there are two, as a browser does", () => {
    expect(
      htmlToText('<a HREF="https://evil.example" href="https://bank.example">Your bank</a>'),
    ).toBe("Your bank <https://evil.example>");
  });

  it("keeps a quoted > inside the tag and leaves out an address with brackets or quotes", () => {
    expect(htmlToText('<p><a href="https://x.example/a>b" title=">">click</a> here</p>')).toBe(
      "click here",
    );
  });

  it("ends the tag at the first > when a quote sits inside an unquoted value, as a browser does", () => {
    expect(htmlToText('<a x=a"> href=https://bank.example ">Your bank</a>')).toBe(
      'href=https://bank.example ">Your bank',
    );
  });

  it("reads a quoted value that never closes up to the end, as a browser does", () => {
    expect(htmlToText('<p>Hi</p><a href="https://bank.example>Your bank</a> more')).toBe("Hi");
  });

  it("reads an = where a name should start as part of the name, as a browser does", () => {
    expect(htmlToText('<a ="x>Hi</a> and <a href="https://example.com">more</a>')).toBe(
      "Hi and more <https://example.com>",
    );
  });

  it("cuts a long link address", () => {
    const address = `https://example.com/${"a".repeat(300)}`;
    expect(htmlToText(`<a href="${address}">Open</a>`)).toBe(`Open <${address.slice(0, 200)}…>`);
  });

  it("decodes numeric entities and leaves impossible ones alone", () => {
    expect(htmlToText("<p>Caf&#233; &#xE9;t&#X E9; &#0; &#x110000;</p>")).toBe(
      "Café ét&#X E9; &#0; &#x110000;",
    );
  });

  it("reads an unclosed tag up to the end, as a browser does", () => {
    expect(htmlToText("<p>Hi</p><style>p{color:red}")).toBe("Hi");
    expect(htmlToText("<p>Hi</p><script>x()")).toBe("Hi");
    expect(htmlToText('<p>Hi <a href="https://example.com">there')).toBe(
      "Hi there <https://example.com>",
    );
    expect(htmlToText('<p>Hi</p><img src="x.png"')).toBe("Hi");
  });

  it("keeps a < that doesn't start a tag, as a browser does", () => {
    expect(htmlToText("5 <10 items, see you")).toBe("5 <10 items, see you");
    expect(htmlToText("<p>a < b</p><!-- note --><?xml?>c")).toBe("a < b\nc");
  });
});

/**
 * A large mail full of tags that never close. Each of these took seconds or
 * minutes when a pattern waited for the closer: 400,000 characters of `<a `
 * took 52 seconds.
 */
const unclosedTags = [
  "<a href=x>",
  "<a ",
  '<a x="',
  "<a x='",
  '<a x=a"',
  '<a "',
  '<p style="',
  "<style>",
  "<style ",
  "<script>",
  "<b ",
  '<p style="/*',
  "<style>/*",
  "<",
  "< ",
  "<div ",
  "<div /",
  '<div x=a"',
  '<div ="',
];

describe.each(unclosedTags)("a large mail full of %j", (unclosed) => {
  const html = unclosed.repeat(Math.ceil(2_000_000 / unclosed.length));

  it.each([
    ["htmlToText", htmlToText],
    ["hidesText", hidesText],
  ])("goes through %s quickly", (_name, read: (html: string) => unknown) => {
    const started = performance.now();
    read(html);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe("hidesText", () => {
  it.each([
    '<span style="display:none">x</span>',
    '<div style="visibility: hidden">x</div>',
    '<span style="font-size:0px">x</span>',
    '<span style="opacity:0">x</span>',
    '<font style="color:#ffffff">x</font>',
    "<p style='color: white'>x</p>",
    `<p style="font-family:'Arial';display:none">x</p>`,
    '<span style="mso-hide:all">x</span>',
    "<style>.x{display:none}</style><p class='x'>x</p>",
    '<style type="text/css">@media all { .x { visibility: hidden } }</style>',
    "<div hidden>x</div>",
    '<div data-a="1" HIDDEN="hidden">x</div>',
    "<span style=display:none>x</span>",
    '<span style="display:/**/none">x</span>',
    "<style>.x{visibility:/* a */hidden}</style>",
    "<p>x</p><style>.x{display:none}",
    '<div x=a" hidden ">x</div>',
    '<div x=a=" hidden>x</div>',
    "<div/hidden>x</div>",
    '<div ="x><span hidden>x</span>',
    '<p ="x>a</p><p hidden>b</p>',
  ])("finds hidden text in %s", (html) => {
    expect(hidesText(html)).toBe(true);
  });

  it.each([
    '<span style="font-size:0.9em">x</span>',
    '<span style="opacity:0.5">x</span>',
    '<p style="background-color:#fff">x</p>',
    "<p>display:none, as plain text</p>",
    "<style>.button{color:#ffffff;background:#0066cc}</style>",
    '<p class="a hidden b">x</p>',
    '<input type="hidden" name="x">',
    "<style>.x{color:red}/* display:none",
    "<div title=\"a hidden b\" data-x='hidden'>x</div>",
    "<p>5 < 10 hidden items</p>",
  ])("leaves visible text alone: %s", (html) => {
    expect(hidesText(html)).toBe(false);
  });
});
