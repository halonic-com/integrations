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
});

describe("hidesText", () => {
  it.each([
    '<span style="display:none">x</span>',
    '<div style="visibility: hidden">x</div>',
    '<span style="font-size:0px">x</span>',
    '<span style="opacity:0">x</span>',
    '<font style="color:#ffffff">x</font>',
    "<p style='color: white'>x</p>",
  ])("finds hidden text in %s", (html) => {
    expect(hidesText(html)).toBe(true);
  });

  it.each([
    '<span style="font-size:0.9em">x</span>',
    '<span style="opacity:0.5">x</span>',
    '<p style="background-color:#fff">x</p>',
    "<p>display:none, as plain text</p>",
  ])("leaves visible text alone: %s", (html) => {
    expect(hidesText(html)).toBe(false);
  });
});
