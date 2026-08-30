/**
 * INPUT:  EmptyState instances rendered to static markup (no DOM: static rendering only).
 * OUTPUT: assertions that title/hint/action render and the optional glyph is carried through.
 * POS:    unit test for components/ui/empty-state. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "./empty-state.tsx";
import { AlertTriangleIcon } from "@/lib/icons/alert-triangle-icon.js";

describe("EmptyState", () => {
  it("renders the title and optional hint", () => {
    const html = renderToStaticMarkup(
      <EmptyState title="没有符合条件的 Run" hint="调整筛选后重试。" />,
    );
    expect(html).toContain("没有符合条件的 Run");
    expect(html).toContain("调整筛选后重试。");
  });

  it("renders the optional glyph and action slot", () => {
    const html = renderToStaticMarkup(
      <EmptyState icon={AlertTriangleIcon} title="尚未安装 Skill" action={<button type="button">导入</button>} />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("导入");
  });
});
