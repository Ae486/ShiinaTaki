/**
 * INPUT:  none (page root); reads the pause state + activity card through usePerception.
 * OUTPUT: <PerceptionPage> — Privacy Pause controls, the sampling + activity cards, and a pointer row naming the knobs
 *         on the settings page that govern retention.
 * POS:    ui/windows/home/pages/perception — presentational. It shows ONLY what perception.* and the knob registry
 *         already expose; nothing about observation is invented client-side.
 */

import { useHomeStore } from "../../home-store.ts";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { PauseControls } from "./pause-controls.tsx";
import { activityRows, samplingRows } from "./perception-view.ts";
import { usePerception } from "./use-perception.ts";

const RETENTION_KNOBS = ["TAKI_AMBIENT_SCREENSHOT", "TAKI_AMBIENT_SCREENSHOT_RETENTION", "TAKI_ATTACHMENT_TTL_DAYS"];

function RetentionCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <PageCard title="留存策略">
      <p className="mb-2.5 text-xs text-slate-600">截屏开关与留存天数是配置项，在设置页修改（多数需重启生效）。</p>
      <ul className="mb-3 flex flex-col gap-1">
        {RETENTION_KNOBS.map((knob) => (
          <li key={knob}>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{knob}</code>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onOpenSettings} className="text-xs font-medium text-rose-600 hover:text-rose-700">
        前往设置页 →
      </button>
    </PageCard>
  );
}

export function PerceptionPage() {
  const perception = usePerception();
  const navigate = useHomeStore((state) => state.navigate);

  return (
    <>
      <PageHeader title="感知与隐私" hint="暂停观察、查看采样与活动记录，以及留存策略的去处。" />
      <PageBody>
        {perception.error && <PageAlert>{perception.error}</PageAlert>}
        <PauseControls pause={perception.pause} onSet={(params) => void perception.setPause(params)} />
        <PageCard title="采样状态">
          {perception.card ? <LabeledRows rows={samplingRows(perception.card)} /> : <p className="text-xs text-slate-400">读取中…</p>}
        </PageCard>
        <PageCard title="活动卡片">
          <LabeledRows rows={perception.card ? activityRows(perception.card) : []} empty="暂无活动记录" />
        </PageCard>
        <RetentionCard onOpenSettings={() => navigate("settings")} />
      </PageBody>
    </>
  );
}
