import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BubbleTranscriptRow } from "./bubble-transcript-row.tsx";
import type { BubblePresenceRow } from "./bubble-presence.ts";

const render = (row: BubblePresenceRow) => renderToStaticMarkup(<BubbleTranscriptRow row={row} settled={() => undefined} />);

describe("Pet visible bubble surfaces", () => {
  it("renders one literal message-only terminal error without an embedded action", () => {
    const markup = render({ phase: "present", token: 1, item: { kind: "error", key: "error", order: 0,
      text: '<img src=x onerror="alert(1)">' } });
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("<img"); expect(markup).not.toContain("<button");
    expect(markup).toContain("data-keep-interactive");
  });

  it("removes hit-test/accessibility/busy participation from an outgoing tool", () => {
    const markup = render({ phase: "exiting", token: 2, item: { kind: "tool", key: "tool", order: 0,
      toolName: "opaque_route", displayName: "读取文件", status: { phase: "executing" }, stale: false } });
    expect(markup).toContain("读取文件"); expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("inert"); expect(markup).not.toContain("data-keep-interactive");
    expect(markup).not.toContain("animate-pulse"); expect(markup).not.toContain("opaque_route");
  });

  it("ends the busy indicator on a settled failure while retaining the readable tool label", () => {
    const markup = render({ phase: "present", token: 1, item: { kind: "tool", key: "tool", order: 0,
      toolName: "opaque_route", displayName: "读取文件", status: { phase: "settled", outcome: "failed" }, stale: false } });
    expect(markup).toContain("读取文件"); expect(markup).toContain("失败");
    expect(markup).not.toContain("animate-pulse");
  });
});
