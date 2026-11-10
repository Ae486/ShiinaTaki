/**
 * INPUT: Home connection/visibility and Core model profile projections.
 * OUTPUT: grouped Main/Utility configuration, recovery feedback and optional metadata.
 * POS: Settings model entry; replaces six independently saved legacy model connection fields.
 */
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import { useModelProfiles } from "../../use-model-profiles.ts";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";
import { ModelProfileCard } from "./model-profile-card.tsx";
import { ModelCapabilitiesSection } from "./model-capabilities-section.tsx";

export function ModelProfilesSection() {
  const { client, status } = useHomeClient();
  const ready = status.kind === "connected" ? client : null;
  const read = useModelProfiles(ready, usePageActive("settings"));
  const main = read.data?.profiles.find((profile) => profile.slot === "main")?.active ?? null;
  return <section aria-label="模型配置" className="flex flex-col gap-3">
    <div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-text-strong">模型配置</h2>
      <PendingIndicator active={read.pending} label="正在读取模型配置" /></div>
    <p className="text-xs text-text-secondary">先保存草稿，或补全后直接启用。无需重启，测试连接为可选操作。</p>
    {read.error && <FeedbackLine tone="warn" action={{ label: "重新读取", onClick: () => void read.refresh() }}>{read.error}</FeedbackLine>}
    {!read.data && !read.error && <p className="text-xs text-text-secondary">{ready ? "正在读取模型配置…" : "连接恢复后可配置模型。"}</p>}
    <div className="grid gap-4 xl:grid-cols-2">{read.data?.profiles.map((profile) => <ModelProfileCard key={profile.slot}
      input={{ status: profile, client: ready, fresh: read.fresh, observation: read.observation, accept: read.accept, refresh: read.refresh }} />)}</div>
    {read.data && <details className="text-xs text-text-secondary"><summary className="cursor-pointer">查看主模型能力声明</summary>
      <ModelCapabilitiesSection active={main} />
    </details>}
  </section>;
}
