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

  it("decodes numeric entities and leaves impossible ones alone", () => {
    expect(htmlToText("<p>Caf&#233; &#xE9;t&#X E9; &#0; &#x110000;</p>")).toBe(
      "Café ét&#X E9; &#0; &#x110000;",
    );
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
  ])("leaves visible text alone: %s", (html) => {
    expect(hidesText(html)).toBe(false);
  });
});
