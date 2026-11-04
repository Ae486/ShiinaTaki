/**
 * INPUT:  configured MAIN entries and the Settings-owned capability read state.
 * OUTPUT: Chinese model information, catalog declarations and truthful connection-native search availability.
 * POS:    Home model settings — read-only guidance, separate from model activation and application tool availability.
 */
import type { ConfigEntry } from "@taki/shared";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ModelCatalogDetails } from "./model-catalog-details.tsx";
import { ModelCatalogSummary } from "./model-catalog-summary.tsx";
import { useModelCapabilities } from "./use-model-capabilities.ts";

export function ModelCapabilitiesSection({ entries }: { entries: ConfigEntry[] }) {
  const { state, model, connected, refresh } = useModelCapabilities(entries);
  const catalog = state.phase === "idle" ? null : state.data?.catalog ?? null;
  return (
    <section aria-label="主模型信息" className="rounded-lg bg-surface-sunken px-3 py-3 text-xs text-text-secondary">
      <ModelCatalogSummary model={model} catalog={catalog} />
      <p className="mt-1">模型设置在 Core 重启后生效；以下声明不代表当前运行模型已切换。</p>
      {catalog?.status === "declared" && <p className="mt-1">来源：models.dev{catalog.lastUpdated ? ` · 声明更新于 ${catalog.lastUpdated}` : ""}。仅供参考，未验证此连接。</p>}
      {catalog?.status === "declared" && <ModelCatalogDetails catalog={catalog} />}
      {catalog?.status === "declared" && (catalog.imageInput === false || catalog.toolCalling === false) && <p className="mt-1">如需使用目录声明不支持的能力，请核对服务说明或更换主模型。</p>}
      {catalog?.status === "unknown" && <p className="mt-1">{catalog.reason === "unconfigured" ? "补全主模型配置后可查看能力声明。" : "未找到此连接与模型的精确目录匹配，能力保持未知。"}</p>}
      <p className="mt-2">原生联网搜索：当前连接方式不支持。应用搜索工具的可用性取决于已启用的工具。</p>
      {state.phase === "pending" && <p role="status" className="mt-2">正在读取能力声明…</p>}
      {state.phase === "idle" && !connected && <p className="mt-2">连接恢复后可读取能力声明。</p>}
      {(state.phase === "error" || catalog?.status === "unavailable") && (
        <div className="mt-2"><FeedbackLine tone="warn" action={{ label: "稍后重试", onClick: () => void refresh() }}>
          {state.phase === "error" ? state.message : "能力目录暂时不可用，模型配置仍可使用。"}
          {state.phase === "error" && state.data && " 当前显示上次声明。"}
        </FeedbackLine></div>
      )}
    </section>
  );
}
