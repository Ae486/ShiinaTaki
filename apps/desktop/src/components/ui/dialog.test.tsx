/**
 * INPUT:  Dialog static markup plus the pure escape decision.
 * OUTPUT: assertions for the modal contract (role/aria-modal/labelling, backdrop at the dialog tier,
 *         keep-interactive marker), the escape policy (fail-closed renders NO close affordance), and that
 *         escapeRequestsClose is the only path from Escape to onClose.
 * POS:    unit test for components/ui/dialog. Focus trap/restore are DOM-bound and untested (static rendering).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog, escapeRequestsClose } from "./dialog.tsx";

describe("Dialog", () => {
  it("renders the modal shell with role, modal flag, labelling and the dialog z-tier", () => {
    const html = renderToStaticMarkup(
      <Dialog open onClose={() => undefined} labelledBy="title-id">
        <h2 id="title-id">标题</h2>
      </Dialog>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="title-id"');
    expect(html).toContain("z-(--z-dialog)");
    expect(html).toContain("data-keep-interactive");
  });

  it("fail-closed policy: no built-in close button and Escape dismisses nothing", () => {
    const html = renderToStaticMarkup(
      <Dialog open onClose={() => undefined} escapePolicy="none" ariaLabel="操作审批">
        <p>内容</p>
      </Dialog>,
    );
    expect(html).toContain('aria-label="操作审批"');
    expect(html).not.toContain("关闭");
    expect(escapeRequestsClose("none", "Escape")).toBe(false);
  });

  it("dismissible policy renders the built-in close affordance and Escape closes", () => {
    const html = renderToStaticMarkup(
      <Dialog open onClose={() => undefined} escapePolicy="close">
        <p>内容</p>
      </Dialog>,
    );
    expect(html).toContain('aria-label="关闭"');
    expect(escapeRequestsClose("close", "Escape")).toBe(true);
    expect(escapeRequestsClose("close", "Enter")).toBe(false);
  });

  it("renders nothing while closed", () => {
    expect(renderToStaticMarkup(<Dialog open={false} onClose={() => undefined}>x</Dialog>)).toBe("");
  });
});
