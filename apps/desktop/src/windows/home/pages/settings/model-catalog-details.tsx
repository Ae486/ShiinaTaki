/**
 * INPUT:  an exact models.dev declaration and its optional expanded metadata.
 * OUTPUT: ModelCatalogDetails — a keyboard-accessible disclosure for provider/canonical identity and token limits.
 * POS:    Home Settings presentation — catalog limits are reference facts, separate from effective Core settings.
 */
import type { ModelCapabilitiesResult } from "@taki/shared";

type ModelCatalogDetailsProps = { catalog: Extract<ModelCapabilitiesResult["catalog"], { status: "declared" }> };

function limitLabel(limit: number | null): string {
  return limit === null ? "未知" : `${limit.toLocaleString("zh-CN")} tokens`;
}

export function ModelCatalogDetails({ catalog }: ModelCatalogDetailsProps) {
  const metadata = catalog.metadata;
  if (!metadata) return null;
  return <details className="mt-2 min-w-0">
    <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2">目录详情</summary>
    <dl className="mt-2 grid gap-y-1 [overflow-wrap:anywhere]">
      <div><dt className="inline">提供方 ID：</dt><dd className="inline">{catalog.provider}</dd></div>
      <div><dt className="inline">规范模型 ID：</dt><dd className="inline">{metadata.canonicalModelId ?? "目录未提供"}</dd></div>
      <div><dt className="inline">目录上下文上限：</dt><dd className="inline">{limitLabel(metadata.contextLimit)}</dd></div>
      <div><dt className="inline">目录输出上限：</dt><dd className="inline">{limitLabel(metadata.outputLimit)}</dd></div>
    </dl>
    <p className="mt-1">规范 ID 仅表示目录中的模型对应关系；目录上限不会自动修改 Core 的运行设置。</p>
  </details>;
}
