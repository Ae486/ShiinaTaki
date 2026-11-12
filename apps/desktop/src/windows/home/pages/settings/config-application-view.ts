/**
 * INPUT: Core-reported configuration source, consumer boundary and application state.
 * OUTPUT: concise scalar setting status and source labels without inferring runtime success.
 * POS: Settings presentation mapping; status always comes from the actual Core consumer.
 */
import type { ConfigApplication, ConfigEntry } from "@taki/shared";
import type { BadgeTone } from "../../badge.tsx";

const BOUNDARY_COPY: Record<ConfigApplication["boundary"], string> = {
  immediate: "保存后生效。", "next-run": "用于接下来开始的新任务，进行中的任务保留原配置。",
  "next-operation": "用于接下来开始的操作，进行中的操作保留原配置。",
  component: "应用完成后生效。", maintenance: "维护完成后生效。",
  external: "还需在外部服务中完成对应设置。", bootstrap: "启动前读取，需在应用外配置。",
  inapplicable: "当前使用的服务不采用此项设置。",
};
const APPLICATION_LABELS: Record<ConfigApplication["state"], { label: string; tone: BadgeTone }> = {
  draft: { label: "已存草稿", tone: "neutral" },
  applied: { label: "已应用", tone: "ok" }, applying: { label: "正在应用", tone: "neutral" },
  failed: { label: "应用失败", tone: "warn" }, unavailable: { label: "暂不可用", tone: "warn" },
  external: { label: "外部设置", tone: "neutral" }, inapplicable: { label: "当前不适用", tone: "neutral" },
  "restart-required": { label: "重启生效", tone: "warn" },
};

export function configApplicationBadge(entry: ConfigEntry): { label: string; tone: BadgeTone } | null {
  return entry.application ? APPLICATION_LABELS[entry.application.state]
    : entry.apply === "restart" ? { label: "重启生效", tone: "warn" } : null;
}

export function configApplicationHint(entry: ConfigEntry): string | null {
  const application = entry.application;
  if (!application) return null;
  const active = (application.state === "failed" || application.state === "applying") && application.activeValue !== entry.value
    ? ` 当前使用：${application.activeValue === null ? "未设置" : String(application.activeValue)}。` : "";
  return `${BOUNDARY_COPY[application.boundary]}${active}${application.message ? ` ${application.message}` : ""}`;
}

export function configSourceLabel(entry: ConfigEntry): string | null {
  if (entry.origin === "stored" || entry.stored) return "应用配置";
  if (entry.origin === "env") return "环境配置";
  return entry.origin === "default" ? "默认值" : null;
}
