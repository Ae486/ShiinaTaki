/**
 * INPUT:  FeedbackLine instances rendered to static markup (no DOM: static rendering only).
 * OUTPUT: assertions for the role contract (danger → alert, others → status), the tone recipes, and the
 *         inline retry action (the ErrorState-with-retry shape).
 * POS:    unit test for components/ui/feedback-line. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackLine } from "./feedback-line.tsx";

describe("FeedbackLine", () => {
  it("renders danger as role=alert with the danger recipe", () => {
    const html = renderToStaticMarkup(<FeedbackLine tone="danger">读取失败</FeedbackLine>);
    expect(html).toContain('role="alert"');
    expect(html).toContain("bg-danger-soft");
    expect(html).toContain("text-danger-strong");
  });

  it("renders every non-danger tone as role=status", () => {
    for (const tone of ["warn", "ok", "info"] as const) {
      const html = renderToStaticMarkup(<FeedbackLine tone={tone}>提示</FeedbackLine>);
      expect(html).toContain('role="status"');
    }
  });

  it("renders the retry action as a labelled inline button", () => {
    const html = renderToStaticMarkup(
      <FeedbackLine tone="danger" action={{ label: "重试", onClick: () => undefined }}>
        读取失败
      </FeedbackLine>,
    );
    expect(html).toContain("重试");
    expect(html).toContain("<button");
  });
});
