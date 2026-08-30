/**
 * INPUT:  raw observability wire values (initiator/state/outcome/phase/effect kind) and monitor UI enums
 * OUTPUT: Simplified Chinese monitor labels with a raw-string fallback for unknown values (never crashes on new values)
 * POS:    ui/windows/home/pages/monitor — the page's single presentation-label seam (N4). Wire vocabulary delegates to
 *         the shared observabilityLabel map; UI-chrome vocabulary (group headers, filter options, connection kinds)
 *         is local. D68 unifies the layers later; unknown values always fall back to the raw string.
 */
import { RunInitiatorSchema, RunStateSchema, observabilityLabel } from "@taki/shared";
import type { RunInitiator, RunState } from "@taki/shared";

/** Wire values the shared map does not cover yet; checked before it (D68 absorbs these). */
const SUPPLEMENT: Record<string, string> = {
  host: "宿主调用",
  mcp: "MCP 调用",
};

export function wireLabel(value: string): string {
  return SUPPLEMENT[value] ?? observabilityLabel(value);
}

export const INITIATOR_OPTIONS: ReadonlyArray<readonly [RunInitiator, string]> =
  RunInitiatorSchema.options.map((value) => [value, wireLabel(value)] as const);
export const STATE_OPTIONS: ReadonlyArray<readonly [RunState, string]> =
  RunStateSchema.options.map((value) => [value, wireLabel(value)] as const);

export const RUN_GROUP_LABEL = "运行";
export const ATTEMPT_GROUP_LABEL = "尝试";

export function attemptGroupLabel(ordinal: number): string {
  return `${ATTEMPT_GROUP_LABEL} ${ordinal}`;
}

const CONNECTION_KINDS: Record<string, string> = {
  connecting: "连接中",
  reconnecting: "重连中",
  connected: "已连接",
  "pairing-required": "待配对",
  disconnected: "已断开",
  error: "连接错误",
};

export function connectionKindLabel(kind: string): string {
  return CONNECTION_KINDS[kind] ?? kind;
}
