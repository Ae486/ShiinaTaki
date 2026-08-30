/**
 * INPUT:  CopyableRow instances rendered to static markup (no DOM: static rendering only).
 * OUTPUT: assertions for the copy-diagnostic contract: accessible copy control per row, min-w-0/truncate
 *         so long values never blow the layout, mono variant, and the compact strip shape.
 * POS:    unit test for components/ui/copyable-row. The transient success tick is DOM-bound and untested.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyableRow } from "./copyable-row.tsx";

describe("CopyableRow", () => {
  it("renders label, value and an aria-labelled copy control", () => {
    const html = renderToStaticMarkup(<CopyableRow label="Event ID" value="event-1" />);
    expect(html).toContain("Event ID");
    expect(html).toContain("event-1");
    expect(html).toContain('aria-label="复制 Event ID"');
  });

  it("keeps long values inside the row (min-w-0 + truncate) and offers the mono variant", () => {
    const html = renderToStaticMarkup(<CopyableRow label="哈希" value={"a".repeat(80)} mono />);
    expect(html).toContain("min-w-0");
    expect(html).toContain("truncate");
    expect(html).toContain("font-mono");
  });

  it("drops the box chrome in compact mode for status strips", () => {
    const html = renderToStaticMarkup(<CopyableRow label="Core" value="11111111-2222" compact />);
    expect(html).not.toContain("border-border-subtle");
    expect(html).toContain("复制 Core");
  });
});
