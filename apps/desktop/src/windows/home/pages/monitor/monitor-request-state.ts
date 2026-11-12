/**
 * INPUT:  disposable Monitor state and one captured client/Character/Run selection scope
 * OUTPUT: local request guards, semantic failure handling, and immutable row merges
 * POS:    ui/monitor — shared internals of the Monitor controller only; no cross-page refresh protocol
 */
import type { TrajectoryResult, TrajectoryRow } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import type { MonitorViewState } from "./monitor-controller.ts";

export interface MonitorRequestScope {
  target: WsClient;
  generation: number;
  characterId: string;
  runKey: string;
  epoch: number;
}

export interface MonitorSelectionAccess {
  capture(): MonitorRequestScope | undefined;
  current(scope: MonitorRequestScope): boolean;
  read(): MonitorViewState;
  publish(patch: Partial<MonitorViewState>): void;
  failed(cause: unknown): void;
  missingRow(rowKey: string): TrajectoryResult | undefined;
}

const ERRORS: Readonly<Record<string, string>> = {
  OBSERVABILITY_FORBIDDEN: "无权查看这条运行记录。",
  OBSERVABILITY_DISABLED: "运行监视已关闭。",
  RUN_NOT_FOUND: "这条运行记录已不可用。",
  FORBIDDEN: "无权查看运行记录。",
  OBSERVABILITY_EVENT_NOT_FOUND: "这条轨迹记录已不可用。",
  OBSERVABILITY_CURSOR_STALE: "记录位置已失效，请重新选择运行。",
  MONITOR_PROGRESS_STALLED: "记录补读未能继续，请重试。",
};

function errorCode(cause: unknown): string {
  if (typeof cause !== "object" || cause === null) return "";
  const error = cause as { message?: unknown; data?: { code?: unknown }; code?: unknown };
  const code = error.data?.code ?? error.code;
  return typeof code === "string" && code in ERRORS ? code : typeof error.message === "string" ? error.message : "";
}

export function monitorError(cause: unknown): string {
  return ERRORS[errorCode(cause)] ?? "暂时无法读取运行记录，请检查连接后重试。";
}

export function monitorUnavailable(cause: unknown): "monitor" | "run" | "record" | undefined {
  switch (errorCode(cause)) {
    case "FORBIDDEN": case "OBSERVABILITY_DISABLED": return "monitor";
    case "OBSERVABILITY_FORBIDDEN": case "RUN_NOT_FOUND": return "run";
    case "OBSERVABILITY_EVENT_NOT_FOUND": return "record";
    default: return undefined;
  }
}

export const monitorDisabled = (cause: unknown): boolean => errorCode(cause) === "OBSERVABILITY_DISABLED";

export function mergeTrajectoryRows(previous: readonly TrajectoryRow[], next: readonly TrajectoryRow[]): TrajectoryRow[] {
  const rows = new Map(previous.map((row) => [row.seq, row]));
  for (const row of next) if (!rows.has(row.seq)) rows.set(row.seq, row);
  return [...rows.values()].sort((left, right) => left.seq - right.seq);
}

export function mergeForwardPage(previous: TrajectoryResult, page: TrajectoryResult): TrajectoryResult {
  return {
    ...previous, run: page.cursor.seq >= previous.cursor.seq ? page.run : previous.run,
    rows: mergeTrajectoryRows(previous.rows, page.rows),
    cursor: { runKey: page.cursor.runKey, seq: Math.max(previous.cursor.seq, page.cursor.seq) },
    hasMore: page.hasMore,
  };
}
