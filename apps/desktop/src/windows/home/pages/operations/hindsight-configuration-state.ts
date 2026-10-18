/**
 * INPUT:  Shared configuration status with desired settings and permitted API profiles
 * OUTPUT: closed Chinese presentation labels and field-by-field Core comparisons
 * POS:    ui/windows/home/pages/operations — formatting only; never derives health or readiness
 */
import type { HindsightConfigurationStatus, HindsightObservedProfile } from "@taki/shared";

const REASON: Record<HindsightConfigurationStatus["reason"], string> = {
  not_observed: "尚未观测。可手动读取当前 API 配置。",
  observed: "已观测（覆盖不完整）",
  capability_missing: "此实例不支持配置观测；其他记忆功能仍可使用。",
  not_authorized: "未获配置披露授权。需由 Native 部署管理员为此 Bank 授权。",
  connection_unavailable: "Hindsight 连接或所选 Bank 不可用。请检查连接与 Bank 配置。",
  request_failed: "配置观测不可用。请检查连接后重试。",
  invalid_response: "未能验证观测响应，已丢弃配置证据。",
  identity_mismatch: "Bank 身份不一致，已拒绝该配置证据。请检查连接与 Bank。",
  context_changed: "连接或记忆状态已变化，原观测已失效。请重新观测。",
  expired: "观测已过期。请重新观测。",
  runtime_changed: "API 进程已更换，原观测已失效。请重新观测。",
};
export const COMPARISON_LABEL = { match: "一致", mismatch: "不一致", not_requested: "未指定", unknown: "未知" } as const;
const UNKNOWN_PROFILE: Record<Extract<HindsightObservedProfile, { kind: "unknown" }>["reason"], string> = {
  routed_profile: "未知（路由 / 多模型）", unsupported_provider: "未知（不支持的实现）",
  unsafe_identifier: "未知（标识无法安全展示）", unavailable: "未知（配置不可用）",
};
const FIELD_LABEL = {
  defaultProvider: "默认提供方", defaultModel: "默认模型", retainModel: "记忆写入模型", reflectModel: "反思模型",
  consolidationModel: "归纳模型", embeddingProvider: "嵌入提供方", embeddingModel: "嵌入模型",
  rerankerProvider: "重排提供方", rerankerModel: "重排模型",
} as const;
const FIELDS: Array<keyof typeof FIELD_LABEL> = ["defaultProvider", "defaultModel", "retainModel", "reflectModel",
  "consolidationModel", "embeddingProvider", "embeddingModel", "rerankerProvider", "rerankerModel"];

export function configurationNotice(data: HindsightConfigurationStatus): string { return REASON[data.reason]; }

function profileValue(profile: HindsightObservedProfile, field: "provider" | "configuredModel" | "both" = "both"): string {
  if (profile.kind === "disabled") return "已禁用";
  if (profile.kind === "unknown") return UNKNOWN_PROFILE[profile.reason];
  return field === "both" ? `${profile.provider} · ${profile.configuredModel}` : profile[field];
}

export function configurationRows(data: HindsightConfigurationStatus) {
  const profiles = data.observation?.profiles;
  const actual = {
    defaultProvider: profiles ? profileValue(profiles.default, "provider") : "未观测",
    defaultModel: profiles ? profileValue(profiles.default, "configuredModel") : "未观测",
    retainModel: profiles ? profileValue(profiles.retain) : "未观测",
    reflectModel: profiles ? profileValue(profiles.reflect) : "未观测",
    consolidationModel: profiles ? profileValue(profiles.consolidation) : "未观测",
    embeddingProvider: "未知（不在覆盖范围）", embeddingModel: "未知（不在覆盖范围）",
    rerankerProvider: "未知（不在覆盖范围）", rerankerModel: "未知（不在覆盖范围）",
  };
  return FIELDS.map((field) => {
    return { field, label: FIELD_LABEL[field], desired: data.desired ? data.desired[field] ?? "未指定" : "不可用",
      actual: actual[field], comparison: data.comparison[field] };
  });
}
