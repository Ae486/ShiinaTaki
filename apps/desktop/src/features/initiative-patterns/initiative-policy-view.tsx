/**
 * INPUT: actual Core setup status containing effective scalar policy configuration.
 * OUTPUT: human-readable aggregate limits, timing, source availability and target readiness.
 * POS: shared review/setup disclosure; missing facts remain unknown and IDs are not fallback labels.
 */
import type { InitiativeSetupStatus } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";

const POLICY_LABELS: Record<string, { label: string; divisor?: number; unit?: string }> = {
  TAKI_INITIATIVE_MODEL_HOUR_LIMIT: { label: "每小时最多考虑互动", unit: "次" },
  TAKI_INITIATIVE_UTTERANCE_HOUR_LIMIT: { label: "每小时最多主动说话", unit: "次" },
  TAKI_INITIATIVE_UTTERANCE_DAY_LIMIT: { label: "每天最多主动说话", unit: "次" },
  TAKI_INITIATIVE_UTTERANCE_GAP_MS: { label: "全局说话最短间隔", divisor: 60_000, unit: "分钟" },
  TAKI_INITIATIVE_MODEL_CADENCE_MS: { label: "考虑互动的基准间隔", divisor: 60_000, unit: "分钟" },
  TAKI_INITIATIVE_JITTER_RATIO: { label: "间隔随机浮动", divisor: 0.01, unit: "%" },
  TAKI_INITIATIVE_CHECK_INTERVAL_MS: { label: "定时检查间隔", divisor: 1000, unit: "秒" },
  TAKI_INITIATIVE_BUSY_MAX_WAIT_MS: { label: "忙碌时最长等待", divisor: 1000, unit: "秒" },
  TAKI_INITIATIVE_OUTPUT_TTL_MS: { label: "未送达内容的最长有效期", divisor: 60_000, unit: "分钟" },
};

export function InitiativePolicyView({ setup }: { setup: InitiativeSetupStatus | null }) {
  if (!setup) return <p className="text-xs text-text-secondary">全局限制尚未读取，暂不能确认提案。</p>;
  const value = (key: string) => setup.settings.find((entry) => entry.key === key)?.value;
  const enabled = value("TAKI_INITIATIVE_ENABLED");
  const enabledLabel = (setting: unknown) => setting === true ? "开启" : setting === false ? "关闭" : "未知";
  const target = setup.targetCharacterId === null ? "尚未指定" : setup.targetCharacterId === ACTIVE_CHARACTER_ID ? "当前角色" : "其他角色";
  return <section className="space-y-2 rounded-lg bg-surface-sunken p-3" aria-label="有效全局限制">
    <h3 className="text-sm font-medium">有效全局限制</h3>
    <p className="text-xs">主动互动：{enabled === true ? "开启" : enabled === false ? "关闭" : "未知"} · 对象：{target}（{setup.targetReady ? "已就绪" : "未就绪"}）</p>
    <p className="text-xs">定时检查：{enabledLabel(value("TAKI_INITIATIVE_PERIODIC_ENABLED"))} · 事件检查：{enabledLabel(value("TAKI_INITIATIVE_EVENTS_ENABLED"))}</p>
    <p className="text-xs text-text-secondary">关闭定时检查后，开启的事件检查仍可考虑互动；两者都关闭时不启动新的主动互动。两种检查都必须满足规则、信息有效性和以下全局限制。</p>
    <dl className="space-y-1 text-xs">
      {Object.entries(POLICY_LABELS).map(([key, metadata]) => {
        const current = value(key);
        return <div key={key} className="flex flex-wrap justify-between gap-2"><dt>{metadata.label}</dt>
          <dd>{typeof current === "number" ? `${Math.round(current / (metadata.divisor ?? 1) * 100) / 100} ${metadata.unit}` : "尚未提供"}</dd>
        </div>;
      })}
      <div><dt className="inline">安静时段：</dt><dd className="inline">{String(value("TAKI_INITIATIVE_QUIET_START") ?? "未知")}–{String(value("TAKI_INITIATIVE_QUIET_END") ?? "未知")}（{setup.timezone}{setup.timezoneConfirmed ? "" : "，时区尚未确认"}）</dd></div>
    </dl>
    <p className="text-xs text-text-secondary">以上上限由所有互动规则共同使用。单条规则只能更严格，切换角色不会重置额度。</p>
  </section>;
}
