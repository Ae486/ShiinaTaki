/**
 * INPUT: unwrapped historical plan_follow_up output at the existing tool rendering boundary.
 * OUTPUT: Chinese outcome and finite-window text without canonical/source bindings or raw errors.
 * POS: Desktop presentation only; full Timeline tool parts stay unchanged for replay.
 */
import { InitiativeIntentionSchema, InitiativeIntentionRefusalSchema, type InitiativeIntentionRefusal } from "@taki/shared";
import { readablePatternDate } from "./pattern-labels.ts";

const REFUSALS: Record<InitiativeIntentionRefusal, string> = {
  invalid_request: "跟进时间窗口无效，未创建计划。", source_unavailable: "当前对话来源不可用，未创建计划。",
  source_stale: "当前对话来源已失效，未创建计划。", window_too_long: "跟进窗口过长，需要缩短后再考虑。",
  expired: "跟进窗口已过期，未创建新计划。", capacity: "当前跟进计划已达到数量限制。",
  claim_conflict: "这次跟进已由其他判断处理，未重复安排。",
};
const FALLBACK = "跟进操作已返回，请继续当前对话；是否已保存尚未确认。";

export function followUpToolDetails(input: unknown): string {
  let value: unknown = input;
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return FALLBACK; } }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return FALLBACK;
  const output: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const refusal = InitiativeIntentionRefusalSchema.safeParse(output.reason);
  if (refusal.success) return REFUSALS[refusal.data];
  if (output.status !== "created" && output.status !== "duplicate") return FALLBACK;
  const state = InitiativeIntentionSchema.shape.state.safeParse(output.state);
  const start = InitiativeIntentionSchema.shape.notBefore.safeParse(output.notBefore);
  const end = InitiativeIntentionSchema.shape.expiresAt.safeParse(output.expiresAt);
  const disposition = InitiativeIntentionSchema.shape.disposition.safeParse(output.disposition);
  if (!state.success || !start.success || !end.success || !disposition.success || Date.parse(start.data) >= Date.parse(end.data)) return FALLBACK;
  const label = state.data === "active" ? "等待有效时机" : state.data === "claimed" ? "已安排一次判断"
    : disposition.data === "expired" ? "已过期，不再触发" : "已结束，不再重复触发";
  return [output.status === "created" ? "已记录后续跟进计划。" : "已有这次跟进计划，保留原有时间窗口。",
    `当前状态：${label}`, `最早考虑时间：${readablePatternDate(start.data, "未知")}`,
    `有效期至：${readablePatternDate(end.data, "未知")}`,
    "会在有效时机考虑是否跟进，不保证发言，也不表示相关事情已经解决。"].join("\n");
}
