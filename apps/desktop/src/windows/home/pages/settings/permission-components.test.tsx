import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCapabilityLabel, getPermissionCellDisplay, PERMISSION_OVERRIDE_LABELS, PERMISSION_POSTURE_LABELS, type PermissionCellsState } from "@taki/shared";
import { PermissionCellsCard } from "./permission-cells-card.tsx";
import { PermissionCellRow, requiresSecondConfirm } from "./permission-cell-row.tsx";
import { PermissionLevelCard } from "./permission-level-card.tsx";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: vi.fn(actual.useState) };
});

const data: PermissionCellsState = {
  level: "standard",
  policyGeneration: 7,
  registryRevision: 1,
  cells: [
    { key: "exec:blocked", level: "standard", capabilityId: "exec", descriptorRevision: 1, factoryPosture: "deny", overridePosture: null, effectivePosture: "deny", approvalMemory: "once-only", overrideMode: "second-confirm" },
    { key: "fs-write:self-escalation", level: "standard", capabilityId: "fs-write", descriptorRevision: 1, factoryPosture: "deny", overridePosture: null, effectivePosture: "deny", approvalMemory: "once-only", overrideMode: "immutable" },
  ],
};

afterEach(() => vi.mocked(React.useState).mockReset());

describe("permission Settings components", () => {
  it("keeps every level choice and explains safety limits without policy bookkeeping", () => {
    const markup = renderToStaticMarkup(<PermissionLevelCard data={data} disabled={false} pending={false} onSetLevel={() => undefined} />);
    for (const label of ["严格", "标准", "宽松"]) expect(markup).toContain(label);
    expect(markup).toContain("设备本地限制、管理策略和固定安全规则始终生效");
    expect(markup).not.toContain("策略代次");
    expect(markup).not.toContain("Execution Host");
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup).toContain('disabled=""');
  });

  it("keeps advanced cells collapsed with readable categories, policy facts, and control names", () => {
    const markup = renderToStaticMarkup(<PermissionCellsCard data={data} disabled={false} pending={null} onSet={() => undefined} />);
    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details open");
    expect(markup).toContain(getCapabilityLabel("exec"));
    expect(markup).toContain('aria-label="命中拦截规则的命令权限设置"');
    expect(markup).toContain(getPermissionCellDisplay("exec:blocked").description);
    expect(markup).toContain(PERMISSION_OVERRIDE_LABELS["second-confirm"]);
    expect(markup).toContain("固定安全规则，不能修改此项。");
    expect(markup).toContain(`默认：${PERMISSION_POSTURE_LABELS.deny}`);
    expect(markup).toContain("自定义：未设置");
    expect(markup).toContain(`生效：${PERMISSION_POSTURE_LABELS.deny}`);
    for (const posture of ["auto", "ask", "deny"] as const) {
      expect(markup).toMatch(new RegExp(`<option[^>]*value="${posture}"[^>]*>${PERMISSION_POSTURE_LABELS[posture]}</option>`));
    }
    for (const internal of ["exec:blocked", "fs-write:self-escalation", "second-confirm", "immutable", "factory ", "override ", "effective "]) {
      expect(markup).not.toContain(internal);
    }
    expect(markup).not.toContain("注册表");
  });

  it("keeps exact cell identity, level, pending state and confirmation generation behind readable headings", () => {
    const onSet = vi.fn();
    const tree = PermissionCellsCard({ data, disabled: false, pending: data.cells[0]!.key, onSet });
    const rows = elementsOfType<React.ComponentProps<typeof PermissionCellRow>>(tree, PermissionCellRow);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.props.policyGeneration).toBe(data.policyGeneration);
    expect(rows[0]!.props.pending).toBe(true);
    expect(rows[1]!.props.pending).toBe(false);
    rows[0]!.props.onSet("auto", true);
    rows[0]!.props.onSet(null);
    expect(onSet.mock.calls).toEqual([
      [{ key: "exec:blocked", level: "standard", posture: "auto", secondConfirm: true }],
      [{ key: "exec:blocked", level: "standard", posture: null, secondConfirm: undefined }],
    ]);
  });

  it("keeps unknown categories readable without exposing the canonical fallback keys", () => {
    const unknown = { ...data.cells[0]!, key: "legacy-cell", capabilityId: "legacy.capability" };
    const markup = renderToStaticMarkup(<PermissionCellsCard data={{ ...data, cells: [unknown] }} disabled pending={null} onSet={() => undefined} />);
    expect(markup).toContain(getCapabilityLabel(unknown.capabilityId));
    expect(markup).toContain(getPermissionCellDisplay(unknown.key).label);
    expect(markup).not.toContain(unknown.key);
    expect(markup).not.toContain(unknown.capabilityId);
    expect(markup).toContain('disabled=""');
  });

  it("removes the confirmation action when the policy generation changes", () => {
    vi.mocked(React.useState).mockReturnValue([
      { posture: "auto", generation: data.policyGeneration },
      vi.fn(),
    ]);
    const row = { cell: data.cells[0]!, disabled: false, pending: false, onSet: vi.fn() };
    const current = renderToStaticMarkup(<PermissionCellRow {...row} policyGeneration={data.policyGeneration} />);
    const replaced = renderToStaticMarkup(<PermissionCellRow {...row} policyGeneration={data.policyGeneration + 1} />);
    expect(current).toContain(">再次确认</button>");
    expect(replaced).not.toContain(">再次确认</button>");
    expect(row.onSet).not.toHaveBeenCalled();
  });

  it("requires a second confirmation only when a second-confirm cell is loosened", () => {
    expect(requiresSecondConfirm(data.cells[0]!, "auto")).toBe(true);
    expect(requiresSecondConfirm(data.cells[0]!, "deny")).toBe(false);
    expect(requiresSecondConfirm(data.cells[1]!, "auto")).toBe(false);
  });
});

function elementsOfType<Props>(tree: React.ReactNode, type: unknown): React.ReactElement<Props>[] {
  return React.Children.toArray(tree).flatMap((child) => {
    if (!React.isValidElement<Props & { children?: React.ReactNode }>(child)) return [];
    return [
      ...(child.type === type ? [child] : []),
      ...elementsOfType<Props>(child.props.children, type),
    ];
  });
}
