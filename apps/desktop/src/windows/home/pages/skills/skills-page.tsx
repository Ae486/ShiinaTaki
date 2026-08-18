/**
 * INPUT: controller-owned Core Skill state plus bounded browser ZIP/directory picks
 * OUTPUT: complete lifecycle page with import, inspect, enable/disable, replace, reconcile, and confirmed removal
 * POS:    Home Skills presentation; no transport ownership, write replay, or authoritative local cache
 */
import { useRef, useState, type RefObject } from "react";
import type { SkillInspectResult, SkillPackageView, SkillStandardMetadata } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { Badge } from "../../badge.tsx";
import { ExtensionConvergenceStrip, useExtensionConvergence } from "../../extension-convergence.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { readDirectorySource, readZipSource } from "./skill-import-files.ts";
import { useSkills } from "./use-skills.ts";

export function SkillsPage() {
  const skills = useSkills(); const [confirmRemove, setConfirmRemove] = useState<string | null>(null); const [fileError, setFileError] = useState<string | null>(null); const replaceId = useRef<string | undefined>(undefined); const zipRef = useRef<HTMLInputElement>(null); const directoryRef = useRef<HTMLInputElement>(null);
  const rows = skills.state.packages; const busy = skills.state.pending !== null; const pick = (kind: "zip" | "directory", packageId?: string) => { replaceId.current = packageId; setFileError(null); (kind === "zip" ? zipRef : directoryRef).current?.click(); };
  const convergence = useExtensionConvergence(skillConvergenceKey(rows));
  const submit = async (source: Awaited<ReturnType<typeof readZipSource>>) => { const replacing = replaceId.current ? rows?.find((row) => row.packageId === replaceId.current) : undefined; await skills.controller.importPackage({ source, ...(replacing ? { replacePackageId: replacing.packageId, expectedConfigRevision: replacing.configRevision } : {}) }); };
  return <><PageHeader title="Skills" hint="导入标准 SKILL.md 包；Core 验证、持久化并即时更新 Agent 可用目录。" busy={busy} /><ExtensionConvergenceStrip state={convergence} /><PageBody>
    {skills.status.kind === "reconnecting" && <PageAlert>正在重新连接 Core；当前写操作已停用，未确认的写入不会重放。</PageAlert>}
    {(skills.state.message || fileError) && <PageAlert>Skill 操作失败：{fileError ?? skills.state.message}</PageAlert>}
    <Pickers zipRef={zipRef} directoryRef={directoryRef} onZip={async (file) => { try { await submit(await readZipSource(file)); } catch (error) { setFileError(readable(error)); } }} onDirectory={async (files) => { try { await submit(await readDirectorySource(files)); } catch (error) { setFileError(readable(error)); } }} />
    <div className="flex justify-end gap-2"><ActionButton disabled={!skills.connectionReady || busy} onClick={() => void skills.controller.reconcile()}>校验并协调</ActionButton><ActionButton disabled={!skills.connectionReady || busy} onClick={() => pick("directory")}>导入目录</ActionButton><ActionButton tone="primary" disabled={!skills.connectionReady || busy} onClick={() => pick("zip")}>导入 ZIP</ActionButton></div>
    {skills.state.kind === "loading" && rows === null && <p className="text-xs text-slate-400">载入中…</p>}
    {rows?.length === 0 && <PageCard title="尚未安装 Skill"><p className="text-xs text-slate-500">选择包含 SKILL.md 的目录或 ZIP 开始导入。</p></PageCard>}
    {rows?.map((row) => <SkillCard key={row.packageId} row={row} disabled={!skills.connectionReady || busy} confirming={confirmRemove === row.packageId} inspected={skills.state.inspected?.package.packageId === row.packageId ? skills.state.inspected : null} actions={{ inspect: () => void skills.controller.inspect(row.packageId), toggle: () => void skills.controller.setEnabled(row), replaceDirectory: () => pick("directory", row.packageId), replaceZip: () => pick("zip", row.packageId), askRemove: () => setConfirmRemove(row.packageId), cancelRemove: () => setConfirmRemove(null), remove: () => { setConfirmRemove(null); void skills.controller.remove(row); } }} />)}
  </PageBody></>;
}

function Pickers(input: { zipRef: RefObject<HTMLInputElement | null>; directoryRef: RefObject<HTMLInputElement | null>; onZip(file: File): Promise<void>; onDirectory(files: FileList): Promise<void> }) { return <><input ref={input.zipRef} hidden type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void input.onZip(file); }} /><input ref={input.directoryRef} hidden type="file" multiple {...({ webkitdirectory: "" } as Record<string, string>)} onChange={(event) => { const files = event.target.files; event.target.value = ""; if (files?.length) void input.onDirectory(files); }} /></>; }
export function SkillCard(input: { row: SkillPackageView; disabled: boolean; confirming: boolean; inspected: SkillInspectResult | null; actions: { inspect(): void; toggle(): void; replaceDirectory(): void; replaceZip(): void; askRemove(): void; cancelRemove(): void; remove(): void } }) {
  const { row, actions } = input; const rejected = row.lifecycleState !== "active";
  return <PageCard title={row.skillName ?? "Rejected package"} action={<div className="flex gap-1"><Badge tone={rejected ? "warn" : row.enabled ? "ok" : "muted"}>{row.runtimeState}</Badge><Badge tone={row.scanVerdict === "rejected" ? "warn" : "neutral"}>{row.scanVerdict}</Badge></div>}>
    <p className="mb-3 text-xs text-slate-600">{row.description ?? row.failureReason ?? "包未通过验证"}</p><LabeledRows rows={[{ label: "来源", value: `${row.sourceKind} / ${row.trust}` }, { label: "Owner", value: row.ownerHostId }, { label: "哈希", value: row.contentHash ?? "—" }, { label: "修订", value: String(row.configRevision) }, { label: "Catalog generation", value: String(row.catalogGeneration ?? "—") }, { label: "状态", value: `${row.lifecycleState} / ${row.enabled ? "enabled" : "disabled"}` }]} />
    {input.inspected && <div className="mt-3 border-t border-slate-100 pt-3">{input.inspected.metadata && <LabeledRows rows={metadataRows(input.inspected.metadata)} />}<p className="mb-1 mt-3 text-xs font-medium text-slate-600">包文件（{input.inspected.files.length}）</p><p className="max-h-24 overflow-auto whitespace-pre-wrap text-[11px] text-slate-500">{input.inspected.files.length ? input.inspected.files.join("\n") : "无可展示文件"}</p></div>}
    <div className="mt-4 flex flex-wrap justify-end gap-2"><ActionButton disabled={input.disabled} onClick={actions.inspect}>检查</ActionButton>{!rejected && <ActionButton disabled={input.disabled} onClick={actions.toggle}>{row.enabled ? "停用" : "启用"}</ActionButton>}{!rejected && <ActionButton disabled={input.disabled} onClick={actions.replaceDirectory}>替换目录</ActionButton>}{!rejected && <ActionButton disabled={input.disabled} onClick={actions.replaceZip}>替换 ZIP</ActionButton>}{!input.confirming ? <ActionButton tone="danger-soft" disabled={input.disabled} onClick={actions.askRemove}>移除</ActionButton> : <><ActionButton disabled={input.disabled} onClick={actions.cancelRemove}>取消</ActionButton><ActionButton tone="danger" disabled={input.disabled} onClick={actions.remove}>确认移除</ActionButton></>}</div>
  </PageCard>;
}
function metadataRows(metadata: SkillStandardMetadata) { const custom = Object.entries(metadata.metadata ?? {}).map(([key, value]) => `${key}: ${value}`).join(", "); return [{ label: "License", value: metadata.license ?? "—" }, { label: "兼容性", value: metadata.compatibility ?? "—" }, { label: "Allowed tools", value: metadata["allowed-tools"] ?? "—" }, { label: "Metadata", value: custom || "—" }]; }
function skillConvergenceKey(rows: SkillPackageView[] | null): string { return (rows ?? []).map((row) => [row.packageId, row.configRevision, row.catalogGeneration ?? 0, row.runtimeState].join(":")).join("|"); }
function readable(error: unknown): string { return error instanceof Error ? error.message : "未知错误"; }
