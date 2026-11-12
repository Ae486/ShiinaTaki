/**
 * INPUT:  the original configured model ID and its optional exact catalog declaration.
 * OUTPUT: ModelCatalogSummary — friendly/provider names, a brand logo and concise declared capability facts.
 * POS:    Home Settings presentation — retains endpoint model identity and unknown facts without runtime inference.
 */
import type { ModelCapabilitiesResult } from "@taki/shared";
import { ModelProviderLogo } from "./model-provider-logo.tsx";

type ModelCatalogSummaryProps = { model: string | null; catalog: ModelCapabilitiesResult["catalog"] | null };
const MODALITY_LABELS: Readonly<Record<string, string>> = {
  text: "文本", image: "图片", audio: "音频", video: "视频", pdf: "PDF",
};

function declaredLabel(value: boolean | null): string {
  return value === null ? "未知" : value ? "目录声明支持" : "目录声明不支持";
}

function modalitiesLabel(values: string[] | null): string {
  if (values === null) return "未知";
  return values.length === 0 ? "无" : values.map((value) => MODALITY_LABELS[value] ?? value).join("、");
}

export function ModelCatalogSummary({ model, catalog }: ModelCatalogSummaryProps) {
  const declaration = catalog?.status === "declared" ? catalog : null;
  const metadata = declaration?.metadata;
  const providerName = metadata?.providerName ?? declaration?.provider ?? null;
  return <>
    <div className="flex items-start gap-3">
      <ModelProviderLogo key={declaration?.provider ?? "unknown"} logoUrl={metadata?.logoUrl ?? null} providerName={providerName} />
      <div className="min-w-0 flex-1 break-words">
        <p className="font-medium text-text-body">已配置主模型 · {metadata?.displayName ?? model ?? "尚未配置"}</p>
        <p className="mt-1">配置 ID：<span className="[overflow-wrap:anywhere]">{model ?? "尚未配置"}</span></p>
        {declaration && <p className="mt-1">提供方：{providerName} · 图标代表提供方品牌</p>}
      </div>
    </div>
    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
      <div><dt className="inline">工具调用：</dt><dd className="inline">{declaredLabel(declaration?.toolCalling ?? null)}</dd></div>
      <div><dt className="inline">图片输入：</dt><dd className="inline">{declaredLabel(declaration?.imageInput ?? null)}</dd></div>
      {metadata && <>
        <div><dt className="inline">推理：</dt><dd className="inline">{declaredLabel(metadata.reasoning)}</dd></div>
        <div className="min-w-0 break-words"><dt className="inline">输入：</dt><dd className="inline">{modalitiesLabel(metadata.inputModalities)}</dd></div>
        <div className="min-w-0 break-words"><dt className="inline">输出：</dt><dd className="inline">{modalitiesLabel(metadata.outputModalities)}</dd></div>
      </>}
    </dl>
  </>;
}
