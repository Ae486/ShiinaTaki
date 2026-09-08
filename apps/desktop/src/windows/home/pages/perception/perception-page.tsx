/**
 * INPUT:  coherent Perception read state, qualified pause evidence and explicit pause/refresh actions.
 * OUTPUT: truthful sampling/activity/Privacy Pause cards with retained content and local retry paths.
 * POS:    Home Perception presentation — no capture, liveness or pause authority is inferred from clocks or stale data.
 */

import { useHomeStore } from "../../home-store.ts";
import { ActionButton } from "../../action-button.tsx";
import { ReadObservationNotice } from "../../read-observation-notice.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { Skeleton } from "@/components/ui/skeleton.js";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";
import { PauseControls } from "./pause-controls.tsx";
import { activityRows, samplingRows } from "./perception-view.ts";
import { usePerception } from "./use-perception.ts";

const RETENTION_KNOBS = ["TAKI_AMBIENT_SCREENSHOT", "TAKI_AMBIENT_SCREENSHOT_RETENTION", "TAKI_ATTACHMENT_TTL_DAYS"];

function SamplingStatus({ stale, refreshing }: { stale: boolean; refreshing: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
      {stale && !refreshing && <span className="whitespace-nowrap text-warn-strong" title="上次采样调度信息，当前状态尚未确认。">状态待确认</span>}
      <PendingIndicator active={refreshing} label={stale ? "正在重新确认采样状态" : "正在更新采样状态"} />
    </span>
  );
}

function RetentionCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <PageCard title="留存策略">
      <p className="mb-2.5 text-xs text-text-body">截屏开关与留存天数是配置项，在设置页修改（多数需重启生效）。</p>
      <ul className="mb-3 flex flex-col gap-1">
        {RETENTION_KNOBS.map((knob) => (
          <li key={knob}>
            <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-text-body">{knob}</code>
          </li>
        ))}
      </ul>
      <ActionButton tone="link" onClick={onOpenSettings}>
        前往设置页 →
      </ActionButton>
    </PageCard>
  );
}

export function PerceptionPage() {
  const perception = usePerception();
  const navigate = useHomeStore((state) => state.navigate);

  return (
    <>
      <PageHeader title="感知与隐私" hint="暂停观察、查看采样与活动记录，以及留存策略的去处。" busy={perception.refreshing} />
      <PageBody>
        <ReadObservationNotice observation={perception.observation} onRefresh={perception.refresh} disabled={!perception.connectionReady} />
        {perception.error && (
          <PageAlert action={{ label: "重试", onClick: () => void perception.refresh() }}>{perception.error}</PageAlert>
        )}
        <PauseControls
          pause={perception.pause}
          connectionReady={perception.connectionReady}
          onSet={(params) => void perception.setPause(params)}
          read={{ loading: perception.loading, refreshing: perception.refreshing, pending: perception.pending, stale: perception.stale }}
        />
        <PageCard title="采样状态" action={<SamplingStatus stale={perception.stale && perception.card !== null} refreshing={perception.refreshing} />}>
          {perception.card && <LabeledRows rows={samplingRows(perception.card)} />}
          {!perception.card && perception.loading && <Skeleton lines={3} />}
          {!perception.card && !perception.loading && <p className="text-xs text-text-secondary">采样调度状态尚未确认。</p>}
        </PageCard>
        <PageCard title="活动卡片">
          {perception.card && <LabeledRows rows={activityRows(perception.card)} empty="暂无活动记录" />}
          {!perception.card && perception.loading && <Skeleton lines={3} />}
          {!perception.card && !perception.loading && <p className="text-xs text-text-secondary">活动记录尚未读取。</p>}
        </PageCard>
        <RetentionCard onOpenSettings={() => navigate("settings")} />
        <div className="flex justify-end"><ActionButton disabled={!perception.connectionReady} onClick={() => void perception.refresh()}>刷新状态</ActionButton></div>
      </PageBody>
    </>
  );
}
