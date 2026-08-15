/**
 * INPUT:  replaceable Home WsClient generations and canonical Approval list/revoke responses
 * OUTPUT: createApprovalDecisionsController() — current-generation-only reads, revoke serialization, and refresh
 * POS:    ui/windows/home/pages/settings — framework-free durable-decision view guard; Core remains authoritative
 */
import type { ApprovalListResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";

export type ApprovalDecisionsState =
  | { kind: "loading"; data: ApprovalListResult | null; message: string | null }
  | { kind: "ready"; data: ApprovalListResult; message: string | null; revokingId: string | null }
  | { kind: "error"; data: ApprovalListResult | null; message: string };

export interface ApprovalDecisionsController {
  replace(client: ApprovalDecisionsClient | null): void;
  refresh(): Promise<void>;
  revoke(decisionId: string): Promise<void>;
  dispose(): void;
}

type ApprovalDecisionsClient = Pick<WsClient, "approvalList" | "approvalRevoke">;

interface ControllerState {
  client: ApprovalDecisionsClient | null;
  epoch: number;
  lastGood: ApprovalListResult | null;
  revoking: boolean;
}

export function createApprovalDecisionsController(
  publish: (state: ApprovalDecisionsState) => void,
): ApprovalDecisionsController {
  const state: ControllerState = { client: null, epoch: 0, lastGood: null, revoking: false };
  return {
    replace(client) {
      state.epoch += 1;
      state.client = client;
      state.revoking = false;
      publish({ kind: "loading", data: state.lastGood, message: null });
      if (client) void refresh(state, publish);
    },
    refresh: () => refresh(state, publish),
    revoke: (decisionId) => revoke(state, publish, decisionId),
    dispose() {
      state.epoch += 1;
      state.client = null;
      state.revoking = false;
    },
  };
}

async function refresh(
  state: ControllerState,
  publish: (view: ApprovalDecisionsState) => void,
  message: string | null = null,
): Promise<void> {
  const client = state.client;
  if (!client) return;
  const token = state.epoch;
  publish({ kind: "loading", data: state.lastGood, message });
  try {
    const data = await client.approvalList();
    if (!isCurrent(state, client, token)) return;
    state.lastGood = data;
    publish({ kind: "ready", data, message, revokingId: null });
  } catch (cause) {
    if (isCurrent(state, client, token)) publish({ kind: "error", data: state.lastGood, message: errorMessage(cause) });
  }
}

async function revoke(
  state: ControllerState,
  publish: (view: ApprovalDecisionsState) => void,
  decisionId: string,
): Promise<void> {
  const client = state.client;
  const current = state.lastGood;
  if (!client || !current || state.revoking) return;
  const token = state.epoch;
  state.revoking = true;
  publish({ kind: "ready", data: current, message: null, revokingId: decisionId });
  try {
    const result = await client.approvalRevoke({
      decisionId,
      expectedApprovalGeneration: current.approvalGeneration,
    });
    if (!isCurrent(state, client, token)) return;
    const message = result.status === "stale_generation" ? "审批状态已变化，已重新读取。" : null;
    await refresh(state, publish, message);
  } catch (cause) {
    if (isCurrent(state, client, token)) publish({ kind: "error", data: state.lastGood, message: errorMessage(cause) });
  } finally {
    if (state.epoch === token) state.revoking = false;
  }
}

function isCurrent(state: ControllerState, client: ApprovalDecisionsClient, token: number): boolean {
  return state.client === client && state.epoch === token;
}

function errorMessage(cause: unknown): string {
  void cause;
  return "审批请求失败，请检查连接后重试。";
}
