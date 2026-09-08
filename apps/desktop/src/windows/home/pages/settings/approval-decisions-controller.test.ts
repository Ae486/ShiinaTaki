import { describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCapabilityLabel, type ApprovalDecisionListItem, type ApprovalListResult } from "@taki/shared";
import { ActionButton, type ActionButtonProps } from "../../action-button.tsx";
import { ApprovalDecisionRow } from "./approval-decision-row.tsx";
import {
  createApprovalDecisionsController,
  type ApprovalDecisionsState,
} from "./approval-decisions-controller.ts";

const EMPTY_LIST: ApprovalListResult = {
  approvalGeneration: 4,
  governanceRegistryRevision: 1,
  disclosureRevision: 1,
  decisions: [],
};

function decision(overrides: Partial<ApprovalDecisionListItem> = {}): ApprovalDecisionListItem {
  return {
    decisionId: "11111111-1111-4111-8111-111111111111",
    verdict: "allow",
    binding: {
      bindingRevision: 1,
      identity: {
        capabilityId: "mcp.tool.call",
        ownerHostId: "33333333-3333-4333-8333-333333333333",
        subject: { subjectId: "opaque-target-binding", revision: "opaque-target-revision" },
      },
      descriptorRevision: 1,
      classifierId: "mcp.tool.call.v1",
      classifierRevision: 1,
      cellKey: "mcp-tool-call",
      decisionScopeDigest: "a".repeat(64),
      disclosureRevision: 1,
    },
    bindingDigest: "b".repeat(64),
    provenance: "operator",
    createdAt: "2026-09-05T14:05:00.000Z",
    updatedAt: "2026-09-05T14:05:00.000Z",
    labels: { capability: "调用 MCP 工具", subject: "research · search" },
    usability: { usable: true },
    ...overrides,
  };
}

function revokeControl(row: ReactElement<{ children?: ReactNode }>): ActionButtonProps {
  const control = Children.toArray(row.props.children).find((child) => isValidElement(child) && child.type === ActionButton);
  if (!isValidElement<ActionButtonProps>(control)) throw new Error("Revoke control was not rendered");
  return control.props;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Approval decisions controller", () => {
  it("shares initial demand and restores after hide/show during revoke reconciliation", async () => {
    const pending = deferred<ApprovalListResult>();
    const read = vi.fn().mockResolvedValueOnce(EMPTY_LIST).mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ ...EMPTY_LIST, approvalGeneration: 9 });
    const revoke = vi.fn(async () => ({ status: "revoked" as const, approvalGeneration: 5 }));
    const states: ApprovalDecisionsState[] = [];
    const controller = createApprovalDecisionsController((state) => states.push(state));
    controller.replace({ approvalList: read, approvalRevoke: revoke });
    await controller.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    const done = controller.revoke("11111111-1111-4111-8111-111111111111");
    await new Promise((resolve) => setImmediate(resolve));
    controller.setVisible(false);
    controller.setVisible(true);
    pending.resolve(EMPTY_LIST);
    await done;
    expect(read).toHaveBeenCalledTimes(3);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ kind: "ready", data: { approvalGeneration: 9 } });
  });

  it("suppresses an old client's late list result after generation replacement", async () => {
    const oldList = deferred<ApprovalListResult>();
    const states: ApprovalDecisionsState[] = [];
    const controller = createApprovalDecisionsController((state) => states.push(state));
    controller.replace({
      approvalList: () => oldList.promise,
      approvalRevoke: async () => ({ status: "not_found", approvalGeneration: 4 }),
    });
    controller.replace({
      approvalList: async () => ({ ...EMPTY_LIST, approvalGeneration: 8 }),
      approvalRevoke: async () => ({ status: "not_found", approvalGeneration: 8 }),
    });
    await Promise.resolve();
    oldList.resolve({ ...EMPTY_LIST, approvalGeneration: 5 });
    await Promise.resolve();
    const ready = states.filter((state): state is Extract<ApprovalDecisionsState, { kind: "ready" }> => state.kind === "ready");
    expect(ready.at(-1)?.data.approvalGeneration).toBe(8);
  });

  it("revokes the selected readable row by its exact identity and current generation, then refetches on conflict", async () => {
    const states: ApprovalDecisionsState[] = [];
    const calls: unknown[] = [];
    const selected = decision({ decisionId: "22222222-2222-4222-8222-222222222222" });
    const controller = createApprovalDecisionsController((state) => states.push(state));
    controller.replace({
      approvalList: async () => ({ ...EMPTY_LIST, decisions: [decision(), selected] }),
      approvalRevoke: async (params) => {
        calls.push(params);
        return { status: "stale_generation", approvalGeneration: 5 };
      },
    });
    await Promise.resolve();
    const row = ApprovalDecisionRow({ decision: selected, disabled: false, pending: false, onRevoke: (id) => controller.revoke(id) });
    await revokeControl(row).onClick();
    expect(calls).toEqual([{
      decisionId: selected.decisionId,
      expectedApprovalGeneration: 4,
    }]);
    const ready = states.filter((state): state is Extract<ApprovalDecisionsState, { kind: "ready" }> => state.kind === "ready");
    expect(ready.at(-1)?.message).toBe("审批状态已变化，已重新读取。");
  });

  it("ignores a retired client's late revoke completion", async () => {
    const revoke = deferred<{ status: "revoked"; approvalGeneration: number }>();
    const states: ApprovalDecisionsState[] = [];
    const controller = createApprovalDecisionsController((state) => states.push(state));
    const first = {
      approvalList: async () => EMPTY_LIST,
      approvalRevoke: () => revoke.promise,
    };
    controller.replace(first);
    await Promise.resolve();
    const pending = controller.revoke("11111111-1111-4111-8111-111111111111");
    controller.replace(null);
    revoke.resolve({ status: "revoked", approvalGeneration: 5 });
    await pending;
    expect(states.at(-1)).toEqual({ kind: "idle", data: EMPTY_LIST, message: null });
  });
});

describe("Approval decision row", () => {
  it("shows complete safe target names, creation time and Core usability without binding metadata", () => {
    const target = `research · ${"a".repeat(229)}`;
    const item = decision({ labels: { capability: "调用 MCP 工具", subject: target } });
    const html = renderToStaticMarkup(ApprovalDecisionRow({ decision: item, disabled: false, pending: false, onRevoke: () => undefined }));
    expect(html).toContain(target);
    expect(html).toContain("创建于");
    expect(html).toContain(new Date(item.createdAt).toLocaleString("zh-CN"));
    expect(html).toContain("授权有效");
    for (const internal of [item.decisionId, item.binding.identity.ownerHostId, item.binding.cellKey, item.bindingDigest, "opaque-target-binding", "opaque-target-revision"]) {
      expect(html).not.toContain(internal);
    }
  });

  it("keeps unresolved targets valid and revocable when Core still marks the decision usable", () => {
    const item = decision({ labels: undefined });
    const row = ApprovalDecisionRow({ decision: item, disabled: false, pending: false, onRevoke: () => undefined });
    const html = renderToStaticMarkup(row);
    expect(html).toContain(getCapabilityLabel(item.binding.identity.capabilityId));
    expect(html).toContain("暂无法显示原授权目标的名称。");
    expect(html).toContain("授权有效");
    expect(html).not.toContain("已删除");
    expect(html).not.toContain(item.binding.identity.capabilityId);
    expect(revokeControl(row).disabled).toBe(false);
  });

  it("keeps historical unknown capabilities readable and uses the separate Core usability result", () => {
    const base = decision();
    const item = decision({
      labels: undefined,
      binding: {
        ...base.binding,
        identity: { ...base.binding.identity, capabilityId: "retired capability/raw", subject: undefined },
        cellKey: "retired cell/raw",
      },
      usability: { usable: false, reason: "unknown_capability" },
    });
    const row = ApprovalDecisionRow({ decision: item, disabled: false, pending: false, onRevoke: () => undefined });
    const html = renderToStaticMarkup(row);
    expect(html).toContain("未识别的操作");
    expect(html).toContain("未识别的权限项");
    expect(html).toContain("当前不适用");
    expect(html).not.toContain(item.binding.identity.capabilityId);
    expect(html).not.toContain(item.binding.cellKey);
    expect(html).not.toContain("unknown_capability");
    expect(revokeControl(row).disabled).toBe(false);
  });

  it("preserves disabled and pending revoke feedback independently of readable labels", () => {
    const item = decision();
    for (const pending of [false, true]) {
      const row = ApprovalDecisionRow({ decision: item, disabled: true, pending, onRevoke: () => undefined });
      expect(revokeControl(row).disabled).toBe(true);
      expect(renderToStaticMarkup(row)).toContain(pending ? "撤销中…" : "撤销");
    }
  });
});
