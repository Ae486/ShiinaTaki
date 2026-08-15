import { describe, expect, it } from "vitest";
import type { ApprovalListResult } from "@taki/shared";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Approval decisions controller", () => {
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

  it("uses the current generation for revoke and refetches after a stale result", async () => {
    const states: ApprovalDecisionsState[] = [];
    const calls: unknown[] = [];
    const controller = createApprovalDecisionsController((state) => states.push(state));
    controller.replace({
      approvalList: async () => EMPTY_LIST,
      approvalRevoke: async (params) => {
        calls.push(params);
        return { status: "stale_generation", approvalGeneration: 5 };
      },
    });
    await Promise.resolve();
    await controller.revoke("11111111-1111-4111-8111-111111111111");
    expect(calls).toEqual([{
      decisionId: "11111111-1111-4111-8111-111111111111",
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
    expect(states.at(-1)).toEqual({ kind: "loading", data: EMPTY_LIST, message: null });
  });
});
