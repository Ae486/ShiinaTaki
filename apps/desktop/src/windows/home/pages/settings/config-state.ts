/**
 * INPUT:  config.list entries, config.set outcomes/rejections and config.changed pushes.
 * OUTPUT: pure knob-list transitions — applyChanged / applyStored, plus the refusal vocabulary (refusalOf,
 *         refusalMessage) and the truthful apply verdict (applyVerdict).
 * POS:    ui/windows/home/pages/settings — the node-testable core of use-config: every state move the page makes is a
 *         function here, so the hook stays glue. Server order is preserved — the page never re-sorts knobs.
 */

import { ConfigRefusalReasonSchema, type ConfigApply, type ConfigChanged, type ConfigEntry, type ConfigSetResult, type ConfigRefusalReason } from "@taki/shared";

/** A config.changed push carries the STORED value; the effective value follows it unless an env var shadows the knob. */
export function applyChanged(entries: ConfigEntry[], changed: ConfigChanged): ConfigEntry[] {
  return entries.map((entry) =>
    entry.key === changed.key && !entry.envLocked && !entry.secret
      ? { ...entry, value: changed.value ?? entry.default, stored: changed.value !== null }
      : entry,
  );
}

/** Local echo of an accepted config.set, so the row updates without a second round trip. */
export function applyStored(entries: ConfigEntry[], result: ConfigSetResult): ConfigEntry[] {
  return applyChanged(entries, { key: result.key, value: result.value });
}

const REFUSAL_MESSAGES: Record<ConfigRefusalReason, string> = {
  "unknown-key": "核心不认识这个配置项（版本不一致？）",
  "invalid-value": "取值不合法，已按该项的校验规则拒绝",
  "env-locked": "该项被环境变量锁定，请改环境变量或取消设置后重试",
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
