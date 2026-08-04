/**
 * INPUT:  none (page root); reads the pause state + activity card through usePerception.
 * OUTPUT: <PerceptionPage> — Privacy Pause controls, the sampling + activity cards, and a pointer row naming the knobs
 *         on the settings page that govern retention.
 * POS:    ui/windows/home/pages/perception — presentational. It shows ONLY what perception.* and the knob registry
 *         already expose; nothing about observation is invented client-side.
 */

import { useHomeStore } from "../../home-store.ts";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PauseControls } from "./pause-controls.tsx";
import { activityRows, samplingRows } from "./perception-view.ts";
import { usePerception } from "./use-perception.ts";

const RETENTION_KNOBS = ["TAKI_AMBIENT_SCREENSHOT", "TAKI_AMBIENT_SCREENSHOT_RETENTION", "TAKI_ATTACHMENT_TTL_DAYS"];

function RetentionCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <PageCard title="留存策略">
      <p className="mb-2 text-xs text-slate-600">截屏开关与留存天数是配置项，在设置页修改（多数需重启生效）。</p>
      <ul className="mb-2 list-disc pl-4 text-[11px] text-slate-500">
        {RETENTION_KNOBS.map((knob) => (
          <li key={knob}>
            <code>{knob}</code>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onOpenSettings} className="text-xs text-sky-700 hover:underline">
        前往设置页 →
      </button>
    </PageCard>
  );
}

export function PerceptionPage() {
  const perception = usePerception();
  const navigate = useHomeStore((state) => state.navigate);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-2.5">
        <h1 className="text-sm font-semibold text-slate-700">感知与隐私</h1>
      </header>
      {perception.error && <p className="bg-rose-50 px-4 py-2 text-xs text-rose-700">{perception.error}</p>}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <PauseControls pause={perception.pause} onSet={(params) => void perception.setPause(params)} />
        <PageCard title="采样状态">
          {perception.card ? <LabeledRows rows={samplingRows(perception.card)} /> : <p className="text-xs text-slate-400">读取中…</p>}
        </PageCard>
        <PageCard title="活动卡片">
          <LabeledRows rows={perception.card ? activityRows(perception.card) : []} empty="暂无活动记录" />
        </PageCard>
        <RetentionCard onOpenSettings={() => navigate("settings")} />
      </div>
    </div>
  );
}
