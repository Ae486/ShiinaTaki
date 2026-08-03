/**
 * INPUT:  hostile markdown strings (raw HTML blocks, event-handler attributes, javascript:/data: link targets).
 * OUTPUT: assertions that the default-safe posture holds: raw HTML is escaped to text, dangerous URL schemes are
 *         defanged to empty hrefs, and GFM stays wired — the XSS net for BOTH user and assistant text (shared path).
 * POS:    unit test for markdown-view (node-safe via renderToStaticMarkup). Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownView } from "./markdown-view.tsx";

const render = (text: string) => renderToStaticMarkup(<MarkdownView text={text} />);

describe("MarkdownView default-safe rendering", () => {
  it("escapes a raw <script> block to inert text", () => {
    const html = render("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an <img onerror> injection (no img element, no live attribute)", () => {
    const html = render('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes inline HTML with an event handler", () => {
    const html = render('hello <b onclick="x()">bold</b> world');
    expect(html).not.toContain("<b ");
    expect(html).toContain("&lt;b onclick=");
  });

  it("defangs a javascript: link target to an empty href", () => {
    const html = render("[click](javascript:alert(1))");
    expect(html).toContain('<a href="">click</a>');
    expect(html).not.toContain("javascript:");
  });

  it("defangs a data: link target", () => {
    const html = render("[x](data:text/html;base64,PHNjcmlwdD4)");
    expect(html).toContain('<a href="">x</a>');
    expect(html).not.toContain("data:text/html");
  });

  it("escapes a raw iframe block", () => {
    expect(render('<iframe src="https://evil.example"></iframe>')).not.toContain("<iframe");
  });

  it("keeps safe https links and GFM tables working (the safe config stays wired)", () => {
    expect(render("visit https://ok.example")).toContain('href="https://ok.example"');
    expect(render("| a | b |\n| - | - |\n| 1 | 2 |")).toContain("<table");
  });
});
