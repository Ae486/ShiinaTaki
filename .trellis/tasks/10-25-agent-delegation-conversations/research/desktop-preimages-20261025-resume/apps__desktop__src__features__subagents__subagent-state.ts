/**
 * INPUT: parsed Shared conversation projections and local reading/action readiness
 * OUTPUT: disposable page state and exact displayed control targets
 * POS: ui/subagents — no durable child state machine or relationship Timeline ownership
 */
import type { SubagentTarget } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import type { SubagentHistory, SubagentList } from "@/lib/ws-client-subagents.js";
import type { ReadObservationState } from "@/lib/read-observation.js";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";

export type SubagentClient = Pick<WsClient, "subagentList" | "subagentHistory" | "subagentResult" |
  "subagentSend" | "subagentStop" | "subagentContinue" | "subscribeSubagents" | "onSubagentChanged">;
export interface SubagentState {
  characterId: string;
  list: SubagentList | null;
  detail: SubagentHistory | null;
  requestedId: string | null;
  selectedId: string | null;
  workInputId: string | null;
  loading: boolean;
  detailLoading: boolean;
  fresh: boolean;
  pending: "send" | "stop" | "continue" | null;
  observation: ReadObservationState;
  readError: string | null;
  detailError: string | null;
  feedback: { tone: "warn" | "danger" | "ok"; message: string } | null;
}
export const INITIAL_SUBAGENT_STATE: SubagentState = {
  characterId: ACTIVE_CHARACTER_ID, list: null, detail: null, requestedId: null, selectedId: null,
  workInputId: null, loading: false, detailLoading: false, fresh: false, pending: null,
  observation: "idle", readError: null, detailError: null, feedback: null,
};

export function displayedTarget(state: SubagentState): SubagentTarget | null {
  const child = state.detail?.conversation;
  if (!child || !state.workInputId || child.subagentId !== state.selectedId) return null;
  return { subagentId: child.subagentId, workInputId: state.workInputId,
    expectedControlVersion: child.controlVersion, expectedRunId: child.activeRunId };
}

export function sameTarget(left: SubagentTarget | null, right: SubagentTarget): boolean {
  return left?.subagentId === right.subagentId && left.workInputId === right.workInputId
    && left.expectedControlVersion === right.expectedControlVersion && left.expectedRunId === right.expectedRunId;
}
