/**
 * INPUT:  one costume list row rendered in each of its states (plain, worn, mid-switch, unrenderable).
 * OUTPUT: assertions for manual check #75 — the row being switched shows a busy indicator AND a reachable Cancel, while
 *         every other row stays an enabled button; plus #74's rule that the accent marks the WORN costume.
 * POS:    unit test for windows/home/pages/costume/costume-row (node-safe via renderToStaticMarkup). Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CostumeRow } from "./costume-row.tsx";
import type { CostumeRowView } from "./costume-view.ts";

const row: CostumeRowView = { id: "taki-summer", renderable: true, badge: null };
const other: CostumeRowView = { id: "taki-default", renderable: true, badge: null };

const markup = (props: Partial<Parameters<typeof CostumeRow>[0]> = {}): string =>
  renderToStaticMarkup(
    <CostumeRow row={row} current={false} pending={false} onSelect={() => {}} onCancel={() => {}} {...props} />,
  );

describe("CostumeRow", () => {
  it("marks the worn costume with the accent (#74: it follows the pet, not the click)", () => {
    expect(markup({ current: true })).toContain("text-rose-700");
    expect(markup()).not.toContain("text-rose-700");
  });

  it("shows a busy indicator and a Cancel control on the row being switched (#75)", () => {
    const pending = markup({ pending: true });

    expect(pending).toContain("animate-spin");
    expect(pending).toContain("taki-summer");
    expect(pending).toContain("取消");
  });

  it("leaves every other row an enabled button while one row is pending (#75)", () => {
    const neighbour = renderToStaticMarkup(
      <CostumeRow row={other} current pending={false} onSelect={() => {}} onCancel={() => {}} />,
    );

    expect(neighbour).toContain("<button");
    expect(neighbour).not.toContain('disabled=""');
  });

  it("keeps an unrenderable costume disabled", () => {
    expect(markup({ row: { id: "taki-broken", renderable: false, badge: null } })).toContain('disabled=""');
  });

  it("renders a degraded costume's badge without disabling it", () => {
    const degraded = markup({ row: { id: "taki-summer", renderable: true, badge: "⚠ 缺 2 动作" } });

    expect(degraded).toContain("⚠ 缺 2 动作");
    expect(degraded).not.toContain('disabled=""');
  });
});
