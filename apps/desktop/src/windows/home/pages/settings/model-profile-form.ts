/**
 * INPUT: editable model connection values and presence-only Core profile state.
 * OUTPUT: profile draft construction, completeness and concise configuration feedback.
 * POS: Settings pure presentation policy; Core remains validation/application authority.
 */
import type { ModelProfileForm, ModelProfileStatus } from "@taki/shared";

export function formFromProfile(status: ModelProfileStatus): ModelProfileForm {
  const { mode, baseUrl, model, auth } = status.draft;
  return { mode, baseUrl, model, auth };
}

export function retainedProfileSecret(form: ModelProfileForm, status: ModelProfileStatus): boolean {
  return [status.draft, status.active].some((profile) =>
    profile?.auth === "api-key" && profile.baseUrl === form.baseUrl && profile.secretSet);
}

export function completeProfile(form: ModelProfileForm, status: ModelProfileStatus): boolean {
  if (form.mode !== "configured") return true;
  return Boolean(form.baseUrl.trim() && form.model.trim()
    && (form.auth === "none" || form.apiKey || retainedProfileSecret(form, status)));
}

export function profileSaveMessage(status: ModelProfileStatus): string {
  if (status.applicationState === "failed") return status.active
    ? "已保存，但应用失败。当前可用配置保持不变，请检查下方提示。"
    : "已保存，但应用失败，暂未启用模型。请检查下方提示。";
  if (status.applicationState === "draft") return "草稿已保存，补全后再次保存即可启用。";
  if (status.state === "disabled") return "已停用，新任务将不再使用此模型。";
  if (status.state !== "ready") return "已保存，当前还没有可用模型。";
  return "已保存并应用，将用于新任务；连接结果以实际调用为准。";
}

export function profileIssueMessage(issue: string): string {
  const messages: Record<string, string> = {
    MODEL_PROFILE_INCOMPLETE: "请补全服务地址、模型 ID 和所选认证信息。",
    MODEL_ID_REQUIRED: "请填写模型 ID。",
    MODEL_URL_INVALID: "服务地址需要有效的 HTTP 或 HTTPS URL。",
    MODEL_CREDENTIAL_UNAVAILABLE: "密钥暂时无法读取，请检查凭据存储或重新填写。",
    MODEL_UNAVAILABLE: "当前没有可用模型。",
  };
  return messages[issue] ?? "配置尚未应用，请检查输入和凭据存储状态。";
}
