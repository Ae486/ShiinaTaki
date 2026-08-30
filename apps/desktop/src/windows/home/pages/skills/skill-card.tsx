/**
 * INPUT:  one Core Skill package view, the inspect result for it (or null), action callbacks and the confirm flag
 * OUTPUT: the detail-pane card (U3): display name + runtime/scan badges, description, 来源/状态 facts, a collapsed
 *         技术详情 disclosure (CopyableRow: Owner/哈希/修订/Catalog 代次), validated metadata + bounded file
 *         inventory once inspected, and 检查/启停/替换/移除 actions with the two-step remove confirm
 * POS:    Home Skills presentation detail; opaque identifiers stay inside the disclosure, absolute paths and package
 *         bytes never render, and a rejected package keeps its truthful 未通过验证 title.
 */

import type { SkillInspectResult, SkillPackageView, SkillStandardMetadata } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { ChevronDownIcon } from "@/lib/icons/chevron-down-icon.js";
import { CopyableRow } from "@/components/ui/copyable-row.js";
import { REJECTED_PACKAGE_TITLE, lifecycleLabel, runtimeLabel, runtimeTone, scanLabel, scanTone, sourceLabel, trustLabel } from "./skill-labels.ts";

export interface SkillCardProps {
  row: SkillPackageView;
  disabled: boolean;
  confirming: boolean;
  inspected: SkillInspectResult | null;
  actions: {
    inspect(): void;
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
        <div className="flex gap-1">
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
      <DetailsDisclosure row={row} />
      {input.inspected && <InspectSection inspected={input.inspected} />}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <ActionButton tone="primary" disabled={input.disabled} onClick={actions.inspect}>检查</ActionButton>
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

/** Owner/哈希/修订/Catalog 代次 leave the primary facts (U3/N6 UI side); copy rows keep the full values. */
function DetailsDisclosure({ row }: { row: SkillPackageView }) {
  return (
    <details className="group mt-3">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-body">
        <ChevronDownIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        技术详情
      </summary>
      <div className="mt-2 flex flex-col gap-1">
        <CopyableRow label="Owner" value={row.ownerHostId} mono />
        <CopyableRow label="哈希" value={row.contentHash ?? "—"} mono />
        <CopyableRow label="修订" value={String(row.configRevision)} />
        <CopyableRow label="Catalog 代次" value={row.catalogGeneration === null ? "—" : String(row.catalogGeneration)} />
      </div>
    </details>
  );
}

/** Validated standard metadata plus the bounded relative-file inventory — never absolute paths or package bytes. */
function InspectSection({ inspected }: { inspected: SkillInspectResult }) {
  return (
    <div className="mt-3 border-t border-border-subtle pt-3">
      {inspected.metadata && <LabeledRows rows={metadataRows(inspected.metadata)} />}
      <p className="mb-1 mt-3 text-xs font-medium text-text-body">包文件（{inspected.files.length}）</p>
      <p className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-text-secondary">
        {inspected.files.length ? inspected.files.join("\n") : "无可展示文件"}
      </p>
    </div>
  );
}

function metadataRows(metadata: SkillStandardMetadata) {
  const custom = Object.entries(metadata.metadata ?? {}).map(([key, value]) => `${key}: ${value}`).join(", ");
  return [
    { label: "License", value: metadata.license ?? "—" },
    { label: "兼容性", value: metadata.compatibility ?? "—" },
    { label: "Allowed tools", value: metadata["allowed-tools"] ?? "—" },
    { label: "Metadata", value: custom || "—" },
  ];
}
