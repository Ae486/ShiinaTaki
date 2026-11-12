/**
 * INPUT:  config.list entries, config.set outcomes/rejections and config.changed pushes.
 * OUTPUT: pure knob-list transitions — applyChanged / applyStored, plus the refusal vocabulary (refusalOf,
 *         refusalMessage) and the truthful apply verdict (applyVerdict).
 * POS:    ui/windows/home/pages/settings — the node-testable core of use-config: every state move the page makes is a
 *         function here, so the hook stays glue. Server order is preserved — the page never re-sorts knobs.
 */

import { ConfigRefusalReasonSchema, type ConfigApply, type ConfigChanged, type ConfigEntry, type ConfigSetResult, type ConfigRefusalReason } from "@taki/shared";

/** A push carries stored state. Reset needs a covering read because the environment fallback is not in this frame. */
export function applyChanged(entries: ConfigEntry[], changed: ConfigChanged): ConfigEntry[] {
  return entries.map((entry) =>
    entry.key === changed.key && !entry.secret && entry.apply !== "env-only" && changed.value !== null
      ? { ...entry, value: changed.value, stored: true, origin: "stored" }
      : entry,
  );
}

/** Local echo of an accepted config.set, so the row updates without a second round trip. */
export function applyStored(entries: ConfigEntry[], result: ConfigSetResult): ConfigEntry[] {
  if (result.effectiveValue !== undefined) return entries.map((entry) => entry.key === result.key && !entry.secret
    ? { ...entry, value: result.effectiveValue ?? null, stored: result.value !== null,
      ...(result.origin ? { origin: result.origin } : {}), ...(result.application ? { application: result.application } : {}) }
    : entry);
  return applyChanged(entries, { key: result.key, value: result.value });
}

const REFUSAL_MESSAGES: Record<ConfigRefusalReason, string> = {
  "unknown-key": "核心不认识这个配置项（版本不一致？）",
  "invalid-value": "取值不合法，已按该项的校验规则拒绝",
  "env-locked": "当前 Core 版本仍锁定环境配置，请更新 Core 后再保存",
  secret: "密钥类配置只存于系统凭据管理器，面板不接受写入",
  "env-only": "该项在数据库打开之前就被读取，只能通过环境变量设置",
};

export function refusalMessage(reason: ConfigRefusalReason): string {
  return REFUSAL_MESSAGES[reason];
}

/** Reads the machine-readable refusal off a rejected config.set; null = not a refusal (transport/internal error). */
export function refusalOf(error: unknown): ConfigRefusalReason | null {
  if (typeof error !== "object" || error === null || !("data" in error)) return null;
  const { data } = error as { data: unknown };
  if (typeof data !== "object" || data === null || !("reason" in data)) return null;
  const parsed = ConfigRefusalReasonSchema.safeParse((data as { reason: unknown }).reason);
  return parsed.success ? parsed.data : null;
}

const APPLY_VERDICTS: Record<ConfigApply, string> = {
  live: "已保存，立即生效",
  restart: "已保存，重启 agent core 后生效",
  "env-only": "已保存，但该项只由环境变量决定",
};

/** What the operator must do for the write to take effect — stated truthfully, never assumed live. */
export function applyVerdict(apply: ConfigApply): string {
  return APPLY_VERDICTS[apply];
}

export function configSaveVerdict(result: ConfigSetResult): string {
  const application = result.application;
  if (!application) return applyVerdict(result.apply);
  if (application.state === "draft") return "草稿已保存，补全配置后应用";
  if (application.state === "failed") return "已保存，但应用失败；请检查当前状态";
  if (application.state === "applying") return "已保存，正在应用";
  if (application.state === "unavailable") return "已保存，相关功能暂不可用";
  if (application.state === "inapplicable") return "已保存，当前服务不采用此项设置";
  if (application.state === "external") return "已保存，还需配置外部服务";
  if (application.state === "restart-required") return "已保存，重启后生效";
  if (application.boundary === "next-run") return "已保存，将用于新任务";
  if (application.boundary === "next-operation") return "已保存，将用于新操作";
  return "已保存并应用";
}
