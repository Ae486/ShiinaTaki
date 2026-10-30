/**
 * INPUT: typed Pattern RPC methods and disposable list/detail interaction state.
 * OUTPUT: local controller contracts; all wire payloads remain imported from Shared.
 * POS: Desktop feature boundary between WsClient, controller and React views.
 */
import type { InteractionPatternHistoryResult, InteractionPatternListResult, InteractionPatternView } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";

export type PatternClient = Pick<WsClient,
  "initiativePatternsList" | "initiativePatternRead" | "initiativePatternHistory" | "initiativePatternPropose"
  | "initiativePatternConfirm" | "initiativePatternChangeState" | "initiativePatternRollback" | "onInitiativePatternsChanged">;
export interface PatternDetail {
  pattern: InteractionPatternView | null;
  history: InteractionPatternHistoryResult;
}
export interface PatternState {
  list: InteractionPatternListResult | null;
  detail: PatternDetail | null;
  selectedId: string | null;
  requestedId: string | null;
  loading: boolean;
  detailLoading: boolean;
  fresh: boolean;
  pending: boolean;
  readError: string | null;
  detailError: string | null;
  feedback: { tone: "ok" | "warn" | "danger"; message: string } | null;
}
export const INITIAL_PATTERN_STATE: PatternState = {
  list: null, detail: null, selectedId: null, requestedId: null,
  loading: false, detailLoading: false, fresh: false, pending: false,
  readError: null, detailError: null, feedback: null,
};
