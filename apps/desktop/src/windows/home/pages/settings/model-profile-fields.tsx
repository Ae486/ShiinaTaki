/**
 * INPUT: local model form, secret presence and editor events.
 * OUTPUT: labelled connection fields with explicit authentication and Utility mode choices.
 * POS: Settings presentation only; one grouped save owns all field changes.
 */
import type { ModelProfileForm, ModelProfileStatus } from "@taki/shared";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { retainedProfileSecret } from "./model-profile-form.ts";

interface ProfileFieldsProps {
  status: ModelProfileStatus;
  form: ModelProfileForm;
  change(patch: Partial<ModelProfileForm>): void;
}

export function ModelProfileFields({ status, form, change }: ProfileFieldsProps) {
  return <div className="grid gap-3">
    <Field label="使用方式">
      <select className={FIELD_CONTROL} value={form.mode} onChange={(event) => {
        const mode = event.target.value;
        if (mode === "configured" || mode === "disabled" || mode === "inherit") change({ mode });
      }}>
        {status.slot === "utility" && <option value="inherit">使用主模型</option>}
        <option value="configured">{status.slot === "main" ? "启用主模型" : "使用独立模型"}</option>
        <option value="disabled">停用</option>
      </select>
    </Field>
    {form.mode === "configured" && <ConnectionFields status={status} form={form} change={change} />}
    {form.mode === "inherit" && <p className="text-xs text-text-secondary">后台任务使用当时已应用的主模型配置。</p>}
    {form.mode === "disabled" && <p className="text-xs text-text-secondary">保存后停止新任务使用此模型，已经开始的工作保留原配置。</p>}
  </div>;
}

function ConnectionFields({ status, form, change }: ProfileFieldsProps) {
  const hasSecret = retainedProfileSecret(form, status);
  return <>
    <Field label="服务地址" hint="兼容 OpenAI 的 API 地址，包括服务要求的路径。">
      <input className={FIELD_CONTROL} value={form.baseUrl} placeholder="https://api.example.com/v1"
        autoComplete="off" spellCheck={false} onChange={(event) => change({ baseUrl: event.target.value })} />
    </Field>
    <Field label="模型 ID" hint="可直接输入服务提供的模型 ID，无需目录认证。">
      <input className={FIELD_CONTROL} value={form.model} autoComplete="off" spellCheck={false}
        placeholder="服务中的模型名称" onChange={(event) => change({ model: event.target.value })} />
    </Field>
    <Field label="认证方式">
      <select className={FIELD_CONTROL} value={form.auth} onChange={(event) => {
        const auth = event.target.value;
        if (auth === "none" || auth === "api-key") change({ auth });
      }}>
        <option value="none">无需密钥</option>
        <option value="api-key">API Key</option>
      </select>
    </Field>
    {form.auth === "api-key" && <Field label="API Key" hint={hasSecret ? "此地址已有密钥，留空保留；输入新值可替换。" : "密钥只用于连接，保存后不会回显。"}>
      <input className={FIELD_CONTROL} type="password" value={form.apiKey ?? ""} autoComplete="new-password"
        placeholder={hasSecret ? "已设置" : "输入密钥"} onChange={(event) => change({ apiKey: event.target.value || undefined })} />
    </Field>}
    {form.auth === "none" && status.draft.secretSet && <p className="text-xs text-text-secondary">保存后移除此配置的密钥，不会自动使用环境中的密钥。</p>}
  </>;
}
