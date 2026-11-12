/**
 * INPUT:  one Core Skill package view, the inspect result for it (or null), action callbacks and the confirm flag
 * OUTPUT: package identity/state, curated standard declarations, collapsible relative files, and lifecycle actions
 * POS:    disposable Home Skills detail; bookkeeping, arbitrary metadata, absolute paths, and package bytes stay out
 */

import type { SkillInspectResult, SkillPackageView, SkillStandardMetadata } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import { ActionButton } from "../../action-button.tsx";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { REJECTED_PACKAGE_TITLE, lifecycleLabel, runtimeLabel, runtimeTone, scanLabel, scanTone, sourceLabel, trustLabel } from "./skill-labels.ts";

export interface SkillCardProps {
  row: SkillPackageView;
  disabled: boolean;
  confirming: boolean;
  inspected: SkillInspectResult | null;
  inspection: { open: boolean; pending: boolean; stale: boolean; error: string | null };
  actions: {
    inspect(): void;
    setInspectionOpen(open: boolean): void;
    toggle(): void;
    replaceDirectory(): void;
    replaceZip(): void;
    askRemove(): void;
    cancelRemove(): void;
    remove(): void;
  };
}

export function SkillCard(input: SkillCardProps) {
  const { row, actions } = input;
  const rejected = row.lifecycleState !== "active";
  return (
    <PageCard
      title={row.skillName ?? REJECTED_PACKAGE_TITLE}
      action={
        <div className="flex items-center gap-1">
          <PendingIndicator active={input.inspection.pending} label="正在检查技能包" className="text-text-secondary" />
          <Badge tone={runtimeTone(row.runtimeState)}>{runtimeLabel(row.runtimeState)}</Badge>
          <Badge tone={scanTone(row.scanVerdict)}>{scanLabel(row.scanVerdict)}</Badge>
        </div>
      }
    >
      <p className="text-xs leading-snug text-text-body">{row.description ?? row.failureReason ?? "包未通过验证"}</p>
      <div className="mt-2">
        <LabeledRows rows={[
          { label: "来源", value: `${sourceLabel(row.sourceKind)} / ${trustLabel(row.trust)}` },
          { label: "状态", value: `${lifecycleLabel(row.lifecycleState)} / ${row.enabled ? "已启用" : "已停用"}` },
        ]} />
      </div>
      {(input.inspected || input.inspection.error) && <InspectSection input={input} />}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <ActionButton tone="primary" disabled={input.disabled || input.inspection.pending} onClick={actions.inspect}>检查</ActionButton>
        {!rejected && <ActionButton disabled={input.disabled} onClick={actions.toggle}>{row.enabled ? "停用" : "启用"}</ActionButton>}
        {!rejected && <ActionButton disabled={input.disabled} onClick={actions.replaceDirectory}>替换目录</ActionButton>}
        {!rejected && <ActionButton disabled={input.disabled} onClick={actions.replaceZip}>替换 ZIP</ActionButton>}
        {!input.confirming
          ? <ActionButton tone="danger-soft" disabled={input.disabled} onClick={actions.askRemove}>移除</ActionButton>
          : <>
            <ActionButton disabled={input.disabled} onClick={actions.cancelRemove}>取消</ActionButton>
            <ActionButton tone="danger" disabled={input.disabled} onClick={actions.remove}>确认移除</ActionButton>
          </>}
      </div>
    </PageCard>
  );
}

/** Inspection keeps its current validated result when collapsed; only another inspect action refetches it. */
function InspectSection({ input }: { input: SkillCardProps }) {
  const { inspected, inspection, actions } = input;
  return (
    <div className="mt-3 border-t border-border-subtle pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-body">检查结果</p>
        <ActionButton tone="ghost" aria-expanded={inspection.open} onClick={() => actions.setInspectionOpen(!inspection.open)}>
          {inspection.open ? "收起" : "展开"}
        </ActionButton>
      </div>
      {inspection.error && <FeedbackLine tone="danger">检查失败：{inspection.error}，可再次点击检查。</FeedbackLine>}
      {inspection.stale && <FeedbackLine tone="warn">技能包已变化；下方为上次检查结果，请点击检查以读取最新内容。</FeedbackLine>}
      {inspection.open && inspected && (
        <>
          {inspected.metadata && <LabeledRows rows={metadataRows(inspected.metadata)} />}
          <p className="mb-1 mt-3 text-xs font-medium text-text-body">包文件（{inspected.files.length}）</p>
          <p className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-text-secondary">
            {inspected.files.length ? inspected.files.join("\n") : "无可展示文件"}
          </p>
        </>
      )}
    </div>
  );
}

function metadataRows(metadata: SkillStandardMetadata) {
  return [
    { label: "许可协议", value: metadata.license },
    { label: "兼容性", value: metadata.compatibility },
    { label: "声明使用的工具", value: metadata["allowed-tools"] },
  ].flatMap(({ label, value }) => value?.trim() ? [{ label, value }] : []);
}
